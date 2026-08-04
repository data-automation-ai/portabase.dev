# Portabase agent telemetry schema

Opt-in only. Implemented in `utility/telemetry.mjs`. Cloud ingest: `POST /api/cloud/telemetry`.

## Privacy rules

1. Telemetry is off unless `cloud.enabled` is true **and** endpoint + token env vars resolve.
2. Events are allowlisted field sets. Unknown keys are stripped. Forbidden patterns fail closed.
3. Never send passphrase, secrets, connection strings, capsule bytes, or decrypted manifests.
4. Backup and restore continue if Cloud is down; emit failures are logged, never fatal.

## Event envelope

```json
{
  "schemaVersion": 1,
  "eventType": "backup.completed",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "agentId": "agent_optional_customer_label",
  "projectRef": "abcdefghijklmnopqrst",
  "hostname": "backup-box-1",
  "portabaseVersion": "0.4.0",
  "payload": {}
}
```

## Event types

| `eventType` | When | `payload` fields |
| --- | --- | --- |
| `agent.heartbeat` | Periodic / doctor | `scheduleEveryHours`, `providerType`, `lastCapsuleAgeHours` |
| `backup.started` | Backup begins | `capsuleId`, `edition` |
| `backup.completed` | Success (COMPLETE or TRIAL) | `capsuleId`, `status`, `destinationKind`, `verified`, `durationMs`, `errorCount` |
| `backup.failed` | Hard failure | `capsuleId`, `errorClass`, `durationMs` |
| `verify.failed` | Remote/local verify fail | `capsuleId`, `errorClass` |
| `restore.completed` | Guarded restore finished | `mode`, `evidenceStatus`, `durationMs` |
| `schedule.missed` | Heartbeat detects overdue job | `expectedEveryHours`, `hoursSinceLastSuccess` |

## Forbidden content (reject)

Any string field matching (case-insensitive):

- `password`, `passphrase`, `secret`, `service_role`, `sb_secret_`, `private_key`
- `postgres://`, `postgresql://` with credentials
- PEM blocks (`BEGIN .* PRIVATE KEY`)

## Authentication

`Authorization: Bearer <agent token>` issued by Portabase Cloud. Tokens identify a workspace agent, not a Supabase project credential.

## Local webhook (OSS, free)

Customers may still set `alerts.webhookEnv` for a raw JSON POST to their own URL without Cloud. That path is not multi-person escalation; Cloud is.
