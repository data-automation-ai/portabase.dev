import { deriveAccess, getSubscriptionByUserId } from './subscription-store.mjs';

export async function loadCloudAccess(user) {
  const storeKey = `${user.cloudVersion}:${user.id}`;
  const record = (await getSubscriptionByUserId(storeKey)) || (await getSubscriptionByUserId(user.id));
  return { record, access: deriveAccess(record), storeKey };
}

export async function requireCloudAccess(user) {
  const loaded = await loadCloudAccess(user);
  if (!loaded.access.hasAccess) {
    const err = new Error('payment_required');
    err.status = 402;
    err.code = 'payment_required';
    throw err;
  }
  return loaded;
}
