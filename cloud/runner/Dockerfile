# Portabase Cloud Runner — managed container that runs the free open-source engine.
# Staging disk is this container's ephemeral volume. Capsule bytes go to the customer vault.
# Never used as a control-plane store. Never F:.

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/portabase
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY utility ./utility
COPY cloud/runner ./cloud/runner

ENV NODE_ENV=production
ENV PORTABASE_RUNNER_ROLE=sleeping
# Keys are sealed into this process at job start — not baked into the image.
USER node
CMD ["node", "cloud/runner/boot.mjs"]
