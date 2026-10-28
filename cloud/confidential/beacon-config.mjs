export const BEACON_INTERVAL_MS = 72 * 60 * 60 * 1000;
export const BEACON_MAX_SECONDS = 600;
export const BEACON_BUCKET = 'portabase-beacon-delegations-495102144848';
export const BEACON_KMS_KEY = 'projects/portabase-dev/locations/us-central1/keyRings/portabase-beacon/cryptoKeys/delegations';
export const BEACON_WIF_PROVIDER = '//iam.googleapis.com/projects/495102144848/locations/global/workloadIdentityPools/portabase-beacon/providers/confidential-space';
export const BEACON_SCHEDULER_ACCOUNT = 'pb-beacon-scheduler@portabase-dev.iam.gserviceaccount.com';
export const beaconOwner = value => {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw Error('invalid_beacon_owner');
  return value;
};
export const beaconLease = value => {
  if (!/^[a-f0-9-]{36}$/.test(value || '')) throw Error('invalid_beacon_lease');
  return value;
};
