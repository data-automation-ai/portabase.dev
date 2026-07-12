FROM node:24-bookworm-slim

ARG AWSCLI_ARCH=x86_64

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl postgresql-client unzip \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWSCLI_ARCH}.zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip /var/lib/apt/lists/*

WORKDIR /opt/portabase

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY utility ./utility

RUN useradd --create-home --uid 10001 portabase \
    && mkdir -p /work/capsules /work/status \
    && chown -R portabase:portabase /opt/portabase /work

USER portabase

ENTRYPOINT ["node", "utility/portabase.mjs"]
CMD ["help"]
