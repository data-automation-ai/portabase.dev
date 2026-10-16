import { withBlobs } from '../shared/subscription-store.mjs';
import { createMailgunReceiptHandler } from '../shared/notification-receipts.mjs';
export const handler = withBlobs(createMailgunReceiptHandler());
