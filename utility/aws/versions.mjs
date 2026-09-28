/**
 * Portabase AWS Capsule V2 — version constants.
 *
 * Two independent versions:
 *   - capsule format: envelope / kind / encryption binding for an AWS escape package
 *   - inventory schema: the scripted JSON shape packed (or planned) inside that envelope
 *
 * Bump inventory schema when resource fields change.
 * Bump capsule format when the envelope, layer split, or proven-claim rules change.
 *
 * This scaffold does not emit a sealed production .pbase. Versions still exist so
 * later capture/replay can refuse mixed or stale documents.
 */

/** Envelope / kind for an AWS account escape capsule (not a Supabase project capsule). */
export const AWS_CAPSULE_KIND = 'portabase-aws-capsule';

/** Capsule format version (semver). Independent of Supabase capsule.json formatVersion. */
export const AWS_CAPSULE_FORMAT_VERSION = '2.0.0';

/** Inventory JSON schema version packed inside the AWS capsule. */
export const AWS_INVENTORY_SCHEMA_VERSION = '1.0.0';

/** Default capture profile: scripted config in; binaries inventoried, not dumped. */
export const AWS_DEFAULT_PROFILE = 'exclude-binaries';

export const AWS_COVERAGE_CLAIMS = Object.freeze({
  proven: false,
  restoreDrill: 'not-implemented',
  match: false,
  note: 'Never claim MATCH or proven until an AWS restore drill exists and passes.',
});

export function versionBanner() {
  return {
    kind: AWS_CAPSULE_KIND,
    capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
    inventorySchemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
    profile: AWS_DEFAULT_PROFILE,
    coverage: { ...AWS_COVERAGE_CLAIMS },
  };
}
