# Portabase private worker image. Deployment and private GUI access are separate.
# Mount customer-controlled private state; do not keep journals only on ephemeral disk.
# Never used as a control-plane store. Never F:.

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates curl awscli rclone \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g supabase

WORKDIR /opt/portabase
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY utility ./utility
COPY cloud/runner ./cloud/runner

ENV NODE_ENV=production
# Google Cloud Run Jobs & Services execution configuration:
# Scales to zero between scheduled backups. Customer keys arrive via sealed payload
# or keyless GCP Workload Identity / OIDC federation.
ENV PORT=8080
ENV PORTABASE_RUNNER_PLATFORM=google-cloud-run
ENV PORTABASE_GCP_REGION=us-central1

# Runtime credentials are supplied inside the private runner boundary.
# This image does not implement key sealing, attestation or subscription provisioning.
USER node
CMD ["node", "cloud/runner/cloud-run-server.mjs"]
