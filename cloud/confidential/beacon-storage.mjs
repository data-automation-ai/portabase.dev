import { googleAccessToken } from './cloud-config.mjs';
import { BEACON_BUCKET, beaconOwner } from './beacon-config.mjs';

// Only ciphertext and bounded operational metadata enter this bucket.
export function beaconStorage({ token = googleAccessToken, fetchImpl = fetch } = {}) {
  const root = `https://storage.googleapis.com/storage/v1/b/${BEACON_BUCKET}/o`;
  const key = (kind, owner) => {
    if(kind==='control'&&owner==='scheduler')return 'leases/_scheduler.json';
    if (!['delegations', 'leases'].includes(kind)) throw Error('invalid_beacon_record');
    return `${kind}/${beaconOwner(owner)}.json`;
  };
  async function call(url, options = {}) {
    const r = await fetchImpl(url, { ...options, headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return null;
    if ([409, 412].includes(r.status)) return { conflict: true };
    if (!r.ok) throw Error('beacon_store_unavailable');
    const raw = await r.text();
    if (raw.length > 2 * 1024 * 1024) throw Error('beacon_record_too_large');
    return JSON.parse(raw);
  }
  return {
    async get(kind, owner) {
      const url = root + '/' + encodeURIComponent(key(kind, owner));
      const metadata = await call(url);
      if (!metadata) return null;
      // Generation pins the content read to the metadata snapshot.
      const data = await call(url + '?alt=media&generation=' + encodeURIComponent(metadata.generation));
      if (!data) throw Error('beacon_snapshot_changed');
      return { data, generation: metadata.generation };
    },
    async put(kind, owner, data, generation = '0') {
      const body = JSON.stringify(data);
      if (body.length > 256 * 1024) throw Error('beacon_record_too_large');
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${BEACON_BUCKET}/o?uploadType=media&name=${encodeURIComponent(key(kind, owner))}&ifGenerationMatch=${encodeURIComponent(generation)}`;
      const result = await call(url, { method: 'POST', body });
      return result?.conflict ? { modified: false } : { modified: true, generation: result.generation };
    },
    async list(cursor) {
      const response = await call(root + '?prefix=delegations%2F&maxResults=25' + (cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''));
      if (!response) throw Error('beacon_store_unavailable');
      return { owners: (response.items || []).map(x => x.name.match(/^delegations\/([a-f0-9]{64})\.json$/)?.[1]).filter(Boolean), cursor: response.nextPageToken || null };
    },
  };
}
