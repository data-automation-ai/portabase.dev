# Persistent cases and partner submissions

The homepage reads published reports from `/api/cases`. Editors use `/cases/manage`; external contributors can use `/cases/submit` or the submission API. Netlify Blobs stores the durable collection and a separate private access configuration. Local files and function memory are not the database.

New submissions always wait for editorial review. A contributor cannot publish, edit another contributor's case, read drafts, or assign editor access. A source URL is deduplicated using the existing incident identity rules. Repeating the same partner reference and content is idempotent; changing a previously used reference returns a conflict.

## Initial setup (operator)

Run from the reviewed checkout with existing Netlify operator authentication:

```powershell
node scripts/manage-cases.mjs plan
node scripts/manage-cases.mjs seed
node scripts/manage-cases.mjs editor-add --user=<verified-Supabase-account-UUID>
# Or resolve exactly one existing email-confirmed account in the configured auth project:
node scripts/manage-cases.mjs editor-add --email=owner@example.com
```

The seed preserves the 128 existing homepage reports, their identifiers, source labels and dates. Re-running it never overwrites edited records and does not create duplicates. A public request never performs migration.

Create a distinct credential for each approved contributor only after its delivery destination is known:

```powershell
node scripts/manage-cases.mjs partner-create --name="Partner name" --daily-limit=100 --secret-out=.portabase/partner-name.secret
node scripts/manage-cases.mjs partner-revoke --id=<partner-id>
```

The credential is written once to the explicit ignored file and never printed. Only its SHA-256 hash is stored in the private access record. Transfer it through the partner's approved secret configuration mechanism; do not put it into source code, a URL, public chat, logs, or the review page. Remove its local copy through the owner's normal secret handling process when no longer needed. No partner or Grok connection is provisioned automatically by this implementation.

Editor access uses verified Supabase identity plus an explicit UUID allowlist controlled by the operator. Normal customer accounts do not become editors. Remove access with `editor-remove --user=<UUID>`.

## Submission API

Send `POST https://portabase.dev/api/cases/submit`, `Content-Type: application/json`, and `Authorization: Bearer <partner credential>`.

```json
{
  "externalId": "partner-report-2026-10-28-001",
  "case": {
    "kind": "firsthand",
    "date": "2026-10-28",
    "tag": "ACCOUNT ACCESS",
    "title": "A short description of the reported event",
    "body": "A factual summary attributed to the linked source.",
    "source": "Publisher · Oct 28, 2026",
    "href": "https://example.com/report",
    "verified": "Community report; cause not independently verified"
  }
}
```

`kind` is `firsthand` or `official`. `date` is the original report date, not the submission date. Claims are text, never executable HTML. The service does not fetch submitted links or follow instructions embedded in reports.

HTTP 202 means saved for review, not published. An identical retry returns 200 and the same reference. A conflicting reference or existing source returns 409; revoked/invalid access returns 401; the per-partner daily cap returns 429. Retry transient 503 responses with backoff and the same reference. Each request is limited to 12 KB.

## Publication and persistence

Editors save a draft, inspect its source, then explicitly publish the saved version. Editing a published case does not silently change the public copy. Unpublish retains the record. No destructive delete operation is exposed.

The collection uses strong reads and conditional writes to prevent concurrent edits from replacing each other. Expected revisions protect case edits. Recent audit retains the last 10,000 editorial events; case provenance remains in each record. The simple collection has an explicit capacity of 5,000 records / 25 MB; exceeding it fails visibly and calls for a reviewed archive or database migration. Public and editorial APIs paginate results.

If the live feed is unavailable, the homepage labels the bundled 2026-10-28 published snapshot as a snapshot. It does not present that snapshot as a healthy live database, and it never uses a private draft as fallback content.

## Release gates

Deploy all three functions (`cases`, `cases-submit`, `cases-manage`), API redirects, and frontend; seed the persistent store; allowlist the verified editor UUID; then test authenticated review and public visibility. Grok needs a confirmed hosting/integration destination before issuing its submission credential. Unit and browser fixtures do not prove a live integration.
