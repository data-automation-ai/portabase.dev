import { withBlobs } from '../shared/subscription-store.mjs';
import { createTwilioReceiptHandler } from '../shared/notification-receipts.mjs';
export const handler = withBlobs(createTwilioReceiptHandler());
