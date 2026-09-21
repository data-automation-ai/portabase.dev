/**
 * Least-privilege IAM sketches for the customer runner.
 * MAP = inventory / most-recent resolve. SHIP = louder binary export.
 * No admin keys. Placeholders only — never commit real access keys.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const IAM_TIER = Object.freeze({
  MAP: 'map',
  SHIP: 'ship',
});

export function loadMapPolicy() {
  return JSON.parse(readFileSync(join(here, 'portabase-export-map.json'), 'utf8'));
}

export function loadShipPolicy() {
  return JSON.parse(readFileSync(join(here, 'portabase-export-ship.json'), 'utf8'));
}

export function flattenActions(policy) {
  const actions = [];
  for (const statement of policy.Statement || []) {
    for (const action of statement.Action || []) actions.push(action);
  }
  return actions;
}

export function assertLeastPrivilegeSketch(policy, tier = IAM_TIER.MAP) {
  const actions = flattenActions(policy);
  const joined = actions.join(' ');
  if (/AdministratorAccess|iam:CreateUser|iam:CreateAccessKey|iam:AttachUserPolicy/i.test(joined)) {
    throw new Error('IAM sketch must not include admin or key-minting actions');
  }
  if (tier === IAM_TIER.MAP) {
    if (actions.includes('secretsmanager:GetSecretValue')) {
      throw new Error('MAP tier must not GetSecretValue');
    }
    if (actions.includes('s3:GetObject') || actions.includes('ec2:CreateSnapshot') || actions.includes('ec2:CreateStoreImageTask')) {
      throw new Error('MAP tier is list/describe only');
    }
    if (!actions.includes('sts:GetCallerIdentity')) {
      throw new Error('MAP tier requires sts:GetCallerIdentity');
    }
    if (!actions.some((action) => action === 'ec2:Describe*' || action.startsWith('ec2:Describe'))) {
      throw new Error('MAP tier requires EC2 describe for latest snapshots/AMIs');
    }
  }
  if (tier === IAM_TIER.SHIP) {
    if (!actions.includes('s3:GetObject')) {
      throw new Error('SHIP tier must be able to read backup objects');
    }
    if (!actions.includes('ec2:CreateStoreImageTask')) {
      throw new Error('SHIP tier may CreateStoreImageTask for latest AMIs only');
    }
  }
  return true;
}
