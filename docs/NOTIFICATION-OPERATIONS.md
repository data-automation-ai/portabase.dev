# Notification integration and release gates

## Current state

Local implementation connects safe runner telemetry to an owner-scoped outbox,
saved preferences, explicit recipient challenges, and Mailgun/Twilio adapters.
Provider acceptance is not proof of delivery. The scheduled dispatcher and signed
receipt handlers need integration verification before release.

No real email or SMS was sent during these tests. Production provider setup is
unverified. Do not enable sending as part of a general frontend deployment.

## Product-specific configuration

Resolve credentials from the approved AWS bundle first. Deployment environment
fallbacks use only the exact names below; never borrow another product's keys.

| Channel | Required configuration |
| --- | --- |
| Email | `PORTABASE_MAILGUN_API_KEY`, `PORTABASE_MAILGUN_DOMAIN`, `PORTABASE_MAILGUN_FROM` |
| SMS | `PORTABASE_TWILIO_ACCOUNT_SID`, `PORTABASE_TWILIO_AUTH_TOKEN`, `PORTABASE_TWILIO_MESSAGING_SERVICE_SID` |

Email region is `PORTABASE_MAILGUN_REGION=us` or `eu` (default `us`).
Bundle selectors are `portabase-mailgun` and `portabase-twilio`.

Sending requires `PORTABASE_NOTIFICATION_SENDING_ENABLED=true` and the relevant
`PORTABASE_NOTIFICATION_EMAIL_ENABLED=true` or
`PORTABASE_NOTIFICATION_SMS_ENABLED=true`. Leave these disabled until provider
identity and the intended recipients are verified.

Dispatcher limits must be explicitly configured:

- `PORTABASE_NOTIFICATION_MAX_ATTEMPTS_PER_RUN`
- `PORTABASE_NOTIFICATION_EMAIL_DAILY_ATTEMPTS`
- `PORTABASE_NOTIFICATION_EMAIL_DAILY_SENDS`
- `PORTABASE_NOTIFICATION_SMS_DAILY_ATTEMPTS`
- `PORTABASE_NOTIFICATION_SMS_DAILY_SENDS`

Daily limits apply per customer/channel in UTC. They bound attempts/messages,
not dollars or SMS segments. Capacity and per-message pricing must inform the
chosen numbers; this document does not select a commercial allowance.

## Delivery receipt endpoints

The canonical public endpoints are:

| Provider | Public URL | Environment variable |
| --- | --- | --- |
| Twilio | `https://portabase.dev/api/notifications/twilio-receipt` | `PORTABASE_TWILIO_STATUS_CALLBACK_URL` |
| Mailgun | `https://portabase.dev/api/notifications/mailgun-receipt` | `PORTABASE_MAILGUN_WEBHOOK_URL` |

Set `PORTABASE_NOTIFICATION_RECEIPTS_ENABLED=true` only after the functions and
routes are deployed and the product-specific webhook configuration is verified.
Receipt processing can stay enabled after outbound sending is disabled so that
in-flight messages can finish reporting their status.

When receipts are enabled, outbound transport configuration rejects missing or
invalid callback URLs before reserving a challenge or sending. Only HTTPS URLs
on `portabase.dev` at the canonical provider path are allowed. The exact configured
URL is preserved, including any explicit `:443` or query parameters. Do not use a
different URL in the provider configuration or signature verifier.

### Twilio

Every SMS request includes the configured URL as its `StatusCallback` field when
receipts are enabled. Twilio sends a form-encoded POST and signs the exact public
URL plus all form fields using the product account's primary Auth Token. The
handler also checks `AccountSid`. An API acceptance or `sent` status is not a
delivery receipt. See [Twilio status callbacks](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)
and [signature validation](https://www.twilio.com/docs/usage/security).

Verify the provider's retry behavior against this endpoint. A receipt arriving
before its message-ID index is saved returns 503 so it can be retried, rather than
being acknowledged and lost. Accepted verification-challenge sends reserve their
own exclusive message-ID binding. Their authenticated receipts are acknowledged
without creating alert history or verifying a contact; only the customer's code
can verify the destination. This binding contains owner, channel and challenge
identity, with no code, address or message body. Unknown IDs remain retryable.
If the process fails before persisting a returned provider ID, manual recovery
is required; an ambiguous send must not be repeated automatically.

### Mailgun

Mailgun webhooks are external domain/account configuration; setting a deployment
environment variable does not register them. On Portabase's dedicated sending
domain, configure the canonical URL for accepted, delivered, temporary-failure,
and permanent-failure events. Use the same domain and US/EU region as the sending
configuration. Store its webhook signing key under
`PORTABASE_MAILGUN_WEBHOOK_SIGNING_KEY` / `portabase-mailgun.webhook_signing_key`.
The transport checks that signing-key configuration exists when receipts are on.
See [Mailgun webhook configuration](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhooks).

Mailgun's normal event signature covers only timestamp and token; it does not
cryptographically bind the event body or URL. The handler therefore also reads
the configured product domain's Events API and requires matching message and
event IDs before storing delivery facts. The configured API key must have that
read capability, and event retention/availability must be validated live.
Temporary failures and test-mode events cannot establish successful delivery.
See [Mailgun signature scope](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks)
and [event lookup](https://documentation.mailgun.com/docs/inboxready/api-reference/optimize/mailgun/events/get-v3-domain_name-events).

Both handlers use the server-created message-ID index to identify the owner;
callback-supplied owner, recipient, body, and error fields are not persisted.
Duplicate receipts are harmless, old progress cannot downgrade delivery, and
contradictory terminal receipts are recorded as `conflicted` for investigation.

## Customer flow

1. Sign in and open Alerts. Both success and failure preferences default off.
2. Request contact verification. Email uses the account email; SMS accepts the
   customer's E.164 phone number. The main API never accepts a verified flag.
3. Enter the eight-digit challenge within ten minutes. Five wrong attempts exhaust
   the challenge. Codes are not returned by the API or stored in plaintext.
4. Save the desired event preferences. Changing consent or contact revisions
   prevents older queued messages from being redirected or sent under new consent.
5. A registered runner reports a supported event. The server validates its
   credential and projects only approved operational fields before enqueueing.
6. The dispatcher rechecks consent, recipient ownership and agent revocation,
   then reserves capacity before calling the provider.

An unconfigured provider returns an explicit error. No message is labeled sent
merely because settings were saved or a challenge was requested.

## Retry and failure behavior

- Runner retries must preserve the original event timestamp. Owner, immutable
  agent ID, event type and timestamp identify the notification per channel.
- Provider acceptance is recorded separately from a delivery receipt.
- A timeout or ambiguous provider response becomes `unknown`. Do not blindly
  resend: a first attempt may already have reached the provider.
- Unknown outcomes consume reserved send capacity. Explicit rejection may free
  send capacity, while the attempt still counts.
- Missing storage, invalid ownership and stale consent fail closed. Queue failures
  after telemetry persistence return 503 with `telemetryStored: true`.

## Required live proof

Before marking notifications operational, record evidence for verified email and
SMS challenges; wrong/expired/replayed codes; account isolation; preference and
contact revocation; a real runner event; provider acceptance; signed delivery
receipt; duplicate receipt; modified signature/body; an ambiguous send outcome;
and exhausted budgets. Never put actual tokens, codes, addresses or message bodies
in the evidence ledger.

Scheduled dispatch has no public API redirect. Keep the service disabled if
provider identity, verified recipient or receipt verification is missing.

## Related review evidence

Local tests cover the outbox, destinations, transport adapters, configuration,
privacy filtering and browser flows. See `PROJECT_STATUS.md` for the latest tested
checkpoint and remaining live blockers. Passing local tests does not establish
provider delivery or production readiness.
