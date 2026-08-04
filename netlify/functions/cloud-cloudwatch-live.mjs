/**
 * Live CloudWatch Logs for a Cloud workspace — scoped to one secret / tenant stream.
 *
 * Log layout (managed runners):
 *   log group:  /portabase/tenants/{workspaceId}/jobs
 *   stream:     secret/{secretId}/job/{jobId}   OR  secret/{secretId}
 *
 * Filter never returns secret values — only operational lines runners emit.
 * Customers always have retroactive access within retention; this endpoint is the live tail.
 */

import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { verifyCloudUser, jsonResponse } from '../shared/verify-user.mjs';

const LOOKBACK_DEFAULT_MIN = 180;
const MAX_EVENTS = 80;

/** Strip anything that looks like a secret value from log messages before return. */
function redact(message = '') {
  let m = String(message);
  m = m.replace(/sb_secret_[A-Za-z0-9_-]+/gi, 'sb_secret_[REDACTED]');
  m = m.replace(/sbp_[A-Za-z0-9]+/gi, 'sbp_[REDACTED]');
  m = m.replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT_REDACTED]');
  m = m.replace(/(password|passphrase|secret|token|apikey|api_key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  m = m.replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]');
  return m;
}

function header(event, name) {
  const h = event.headers || {};
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : '';
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body);
  } catch {
    return {};
  }
}

function resolveLogGroup({ workspaceId, secretId, explicitGroup }) {
  if (explicitGroup) return explicitGroup;
  const ws = workspaceId || process.env.PORTABASE_DEFAULT_WORKSPACE_ID || 'workspace';
  // Prefer secret-scoped group when secretId present
  if (secretId) {
    return `/portabase/tenants/${ws}/secrets/${secretId}`;
  }
  return `/portabase/tenants/${ws}/jobs`;
}

function streamPrefix({ secretId, jobId }) {
  if (secretId && jobId) return `secret/${secretId}/job/${jobId}`;
  if (secretId) return `secret/${secretId}`;
  if (jobId) return `job/${jobId}`;
  return undefined;
}

async function assumeRole({ roleArn, externalId, region }) {
  const sts = new STSClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
  const out = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `portabase-cw-${Date.now().toString(36)}`,
    ExternalId: externalId || undefined,
    DurationSeconds: 900,
  }));
  const c = out.Credentials;
  if (!c?.AccessKeyId) throw new Error('AssumeRole returned no credentials');
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

function mapLogEvent(ev) {
  return {
    id: ev.eventId || `${ev.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ev.timestamp ? new Date(ev.timestamp).toISOString() : null,
    message: redact(ev.message || ''),
    logStreamName: ev.logStreamName || null,
    ingestionTime: ev.ingestionTime ? new Date(ev.ingestionTime).toISOString() : null,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const q = event.queryStringParameters || {};
  const body = event.httpMethod === 'POST' ? parseBody(event) : {};
  const workspaceId = body.workspaceId || q.workspaceId || user.id || 'workspace';
  const secretId = body.secretId || q.secretId || '';
  const jobId = body.jobId || q.jobId || '';
  const logGroupName = resolveLogGroup({
    workspaceId,
    secretId,
    explicitGroup: body.logGroupName || q.logGroupName || process.env.PORTABASE_CW_LOG_GROUP || '',
  });
  const region = body.region || q.region || process.env.AWS_REGION || 'us-east-1';
  const lookbackMinutes = Number(body.lookbackMinutes || q.lookbackMinutes || LOOKBACK_DEFAULT_MIN);
  const roleArn = body.roleArn || q.roleArn || process.env.PORTABASE_CW_ASSUME_ROLE_ARN || '';
  const externalId = body.externalId || q.externalId || process.env.PORTABASE_AUDIT_EXTERNAL_ID || '';
  // Optional extra filter — e.g. secret ARN resource name (never the secret value)
  const filterPattern = body.filterPattern || q.filterPattern
    || (secretId ? `"secret/${secretId}"` : undefined);

  // Portabase control-plane credentials (default) or assume into log-reader role
  let credentials;
  if (roleArn) {
    try {
      credentials = await assumeRole({ roleArn, externalId, region });
    } catch (err) {
      return jsonResponse(200, {
        mode: 'error',
        live: false,
        scope: { workspaceId, secretId: secretId || null, logGroupName },
        error: `AssumeRole failed: ${err.message}`,
        events: [],
        polledAt: new Date().toISOString(),
      });
    }
  }

  const client = new CloudWatchLogsClient({
    region,
    ...(credentials ? { credentials } : {}),
  });

  const startTime = Date.now() - lookbackMinutes * 60e3;
  const logStreamNamePrefix = streamPrefix({ secretId, jobId });

  try {
    // Optional: list streams for this secret so UI can show scope
    let streams = [];
    try {
      const desc = await client.send(new DescribeLogStreamsCommand({
        logGroupName,
        logStreamNamePrefix: logStreamNamePrefix || (secretId ? `secret/${secretId}` : undefined),
        orderBy: 'LastEventTime',
        descending: true,
        limit: 20,
      }));
      streams = (desc.logStreams || []).map(s => ({
        name: s.logStreamName,
        lastEventAt: s.lastEventTimestamp ? new Date(s.lastEventTimestamp).toISOString() : null,
      }));
    } catch {
      streams = [];
    }

    const filtered = await client.send(new FilterLogEventsCommand({
      logGroupName,
      logStreamNamePrefix: logStreamNamePrefix || undefined,
      startTime,
      limit: MAX_EVENTS,
      filterPattern: filterPattern || undefined,
      interleaved: true,
    }));

    const events = (filtered.events || []).map(mapLogEvent);

    return jsonResponse(200, {
      mode: 'live',
      live: true,
      scope: {
        workspaceId,
        secretId: secretId || null,
        jobId: jobId || null,
        logGroupName,
        logStreamNamePrefix: logStreamNamePrefix || null,
        filterPattern: filterPattern || null,
      },
      streams,
      events,
      polledAt: new Date().toISOString(),
      lagNote: 'CloudWatch is near-real-time after the runner flushes. Scoping is by log group/stream for this secret only — not account-wide.',
      retentionNote: 'Events remain available for retroactive browse within the log group retention period.',
    });
  } catch (err) {
    const msg = err.message || String(err);
    const missing = /ResourceNotFoundException|does not exist/i.test(msg);
    return jsonResponse(200, {
      mode: missing ? 'setup' : 'error',
      live: false,
      scope: {
        workspaceId,
        secretId: secretId || null,
        logGroupName,
        logStreamNamePrefix: logStreamNamePrefix || null,
      },
      error: msg,
      events: [],
      streams: [],
      polledAt: new Date().toISOString(),
      setup: missing ? {
        message: 'Log group not created yet or wrong scope. Managed runners create /portabase/tenants/{workspaceId}/secrets/{secretId} on first job.',
        expectedGroup: logGroupName,
        expectedStreamPrefix: logStreamNamePrefix || `secret/${secretId || '{secretId}'}`,
      } : undefined,
    });
  }
}
