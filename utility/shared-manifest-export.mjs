import { projectSharedManifest } from './shared-manifest.mjs';

/** Build a previewable summary without copying names, diagnostics or credentials. */
export function sharedManifestSummary(metadata, capsuleHash) {
  const counts = {};
  const candidates = {
    tableCount: metadata?.contents?.database?.summary?.tables,
    bucketCount: metadata?.contents?.storage?.bucketCount,
    objectCount: metadata?.contents?.storage?.objectCount,
    functionCount: metadata?.contents?.functions?.count,
  };
  for (const [key, value] of Object.entries(candidates)) {
    if (Number.isSafeInteger(value) && value >= 0) counts[key] = value;
  }
  return projectSharedManifest({ schemaVersion: 1, projectRef: metadata?.projectRef,
    capturedAt: metadata?.createdAt, capsuleHash, status: metadata?.status, counts },
  { projectRef: metadata?.projectRef, inventoryConsent: false });
}
