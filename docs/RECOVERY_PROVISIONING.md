# Guided new-account recovery

PortaBase guides and automates as much as Supabase permits. Some manual intervention is necessary under Supabase's identity, billing, and third-party security rules.

## What the customer must do

- Create or sign in to a Supabase account and complete email, identity, MFA, or CAPTCHA checks.
- Choose or create an organization and approve any billing or payment consequences.
- Create a Personal Access Token in Supabase and enter it locally into PortaBase.
- Re-authorize third-party OAuth providers, SMTP, payment processors, external webhooks, custom domains, and DNS where those providers require owner approval.

## What PortaBase can automate locally

- List organizations available to the supplied token.
- Create a blank project in the selected organization and region.
- Retrieve the new project reference, URL, database host, and administrator API key.
- Construct the target database connection without transmitting credentials to PortaBase.
- Refuse the original source and inspect the destination for existing tables, Auth users, Storage buckets, and Edge Functions.
- Restore database structure/data, Storage objects, and Edge Functions from a complete capsule.
- Run a deliberately limited validation drill from a current trial capsule: database structure and API surface, up to five Storage objects, and up to two Edge Functions.

## Validation versus recovery

The limited drill is designed for a disposable free Supabase project and may be repeated at any time. It proves that the customer can provision a new destination, decrypt the capsule, write representative content, and reach the restored surface. It is not a complete backup or a substitute for a full restore drill.

After either restore mode, PortaBase presents the remaining cutover checklist: client environment keys, Auth providers and redirect URLs, SMTP/templates, external secrets, Realtime/cron settings, webhooks, custom domains, DNS, and application smoke tests.
