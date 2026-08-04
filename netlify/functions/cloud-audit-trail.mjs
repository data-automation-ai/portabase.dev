/**
 * Live CloudTrail lookup for a Cloud workspace.
 *
 * Customer grants Portabase a read-only role (LookupEvents + optional DescribeTrails).
 * We AssumeRole with an external ID, then query their Trail for Portabase-related activity
 * (KMS encrypt/decrypt, S3 put on their vault prefix).
 *
 * Without a connected role, returns connection instructions + empty events (UI uses demo).
 */

import { CloudTrailClient, LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { verifyCloudUser, jsonResponse } from '../shared/verify-user.mjs';

const LOOKBACK_DEFAULT_MIN = 180;
const MAX_EVENTS = 50;

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

function mapEvent(ev) {
  let detail = {};
  try {
    detail = ev.CloudTrailEvent ? JSON.parse(ev.CloudTrailEvent) : {};
  } catch {
    detail = {};
  }
  const resources = (ev.Resources || []).map(r => r.ResourceName || r.ResourceType).filter(Boolean);
  return {
    id: ev.EventId || `${ev.EventTime}-${ev.EventName}`,
    eventTime: ev.EventTime ? new Date(ev.EventTime).toISOString() : null,
    eventName: ev.EventName || detail.eventName || 'Unknown',
    eventSource: ev.EventSource || detail.eventSource || '',
    username: ev.Username || detail.userIdentity?.principalId || detail.userIdentity?.arn || '—',
    resources,
    readOnly: Boolean(detail.readOnly),
    errorCode: detail.errorCode || null,
    awsRegion: detail.awsRegion || null,
    sourceIPAddress: detail.sourceIPAddress || null,
  };
}

async function assumeCustomerRole({ roleArn, externalId, region }) {
  const sts = new STSClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
  const out = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `portabase-audit-${Date.now().toString(36)}`,
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

async function lookupTrailEvents({ credentials, region, lookbackMinutes, usernameContains, resourceContains }) {
  const client = new CloudTrailClient({
    region: region || process.env.AWS_REGION || 'us-east-1',
    credentials,
  });
  const start = new Date(Date.now() - (lookbackMinutes || LOOKBACK_DEFAULT_MIN) * 60e3);
  // LookupEvents allows limited attribute filters; pull recent then filter client-side for vault prefix.
  const res = await client.send(new LookupEventsCommand({
    StartTime: start,
    MaxResults: MAX_EVENTS,
    LookupAttributes: usernameContains
      ? [{ AttributeKey: 'Username', AttributeValue: usernameContains }]
      : undefined,
  }));
  let events = (res.Events || []).map(mapEvent);
  if (resourceContains) {
    const needle = String(resourceContains).toLowerCase();
    events = events.filter(e =>
      e.resources.some(r => String(r).toLowerCase().includes(needle))
      || String(e.eventName).toLowerCase().includes('putobject')
      || String(e.eventName).toLowerCase().includes('encrypt')
      || String(e.eventName).toLowerCase().includes('decrypt'),
    );
  }
  // Prefer crypto + vault related events when unfiltered noise is high
  const interesting = events.filter(e =>
    /kms|s3\.amazonaws|encrypt|decrypt|putobject|copyobject|deletesecret|getsecret/i.test(
      `${e.eventSource} ${e.eventName} ${e.resources.join(' ')}`,
    ),
  );
  return (interesting.length ? interesting : events).slice(0, MAX_EVENTS);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {});
  }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  try {
    await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  const q = event.queryStringParameters || {};
  const body = event.httpMethod === 'POST' ? parseBody(event) : {};
  const roleArn = body.roleArn || q.roleArn || header(event, 'x-portabase-audit-role') || process.env.PORTABASE_DEMO_AUDIT_ROLE_ARN || '';
  const externalId = body.externalId || q.externalId || process.env.PORTABASE_AUDIT_EXTERNAL_ID || '';
  const region = body.region || q.region || process.env.AWS_REGION || 'us-east-1';
  const lookbackMinutes = Number(body.lookbackMinutes || q.lookbackMinutes || LOOKBACK_DEFAULT_MIN);
  const resourceContains = body.resourceContains || q.resourceContains || '';
  const usernameContains = body.usernameContains || q.usernameContains || '';

  if (!roleArn) {
    return jsonResponse(200, {
      mode: 'setup',
      live: false,
      message: 'Connect a customer IAM role that allows cloudtrail:LookupEvents. Console shows demo events until connected.',
      setup: {
        trustPrincipal: process.env.PORTABASE_AUDIT_TRUST_PRINCIPAL || 'arn:aws:iam::YOUR_PORTABASE_ACCOUNT:role/portabase-cloud-audit',
        externalIdRequired: true,
        policyActions: ['cloudtrail:LookupEvents', 'cloudtrail:GetTrailStatus', 'cloudtrail:DescribeTrails'],
        note: 'Trail must be enabled in the customer account for history to exist. Lookup is near-real-time (often 1–5 minutes behind).',
      },
      events: [],
      polledAt: new Date().toISOString(),
    });
  }

  try {
    const credentials = await assumeCustomerRole({ roleArn, externalId, region });
    const events = await lookupTrailEvents({
      credentials,
      region,
      lookbackMinutes,
      usernameContains: usernameContains || undefined,
      resourceContains: resourceContains || undefined,
    });
    return jsonResponse(200, {
      mode: 'live',
      live: true,
      region,
      lookbackMinutes,
      roleArn,
      events,
      polledAt: new Date().toISOString(),
      lagNote: 'CloudTrail is near-real-time, not sub-second. Typical delay is about one to several minutes.',
    });
  } catch (err) {
    return jsonResponse(200, {
      mode: 'error',
      live: false,
      error: err.message || String(err),
      events: [],
      polledAt: new Date().toISOString(),
      setup: {
        hint: 'Verify AssumeRole trust policy, external ID, and cloudtrail:LookupEvents on the customer role.',
      },
    });
  }
}
