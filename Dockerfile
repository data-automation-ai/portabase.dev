# Portabase Google Cloud Run Runner Image (portabase-runner)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/portabase
COPY package.json ./
COPY utility ./utility
COPY cloud/runner ./cloud/runner

ENV NODE_ENV=production
ENV PORT=8080
ENV PORTABASE_RUNNER_PLATFORM=google-cloud-run
ENV PORTABASE_GCP_REGION=us-central1
ENV GOOGLE_CLOUD_PROJECT=portabase-dev

USER node
EXPOSE 8080
CMD ["node", "cloud/runner/cloud-run-server.mjs"]
