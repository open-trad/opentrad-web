ARG DEBIAN_IMAGE
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS node-runtime

FROM ${DEBIAN_IMAGE} AS api-debian-resolved
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY infra/docker/debian-packages.lock.json /build/debian-packages.lock.json
RUN sed -i 's|deb.debian.org/debian-security|mirrors.aliyun.com/debian-security|g; s|deb.debian.org/debian|mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && package_args="$(node -e 'const lock=require(process.argv[1]); process.stdout.write(lock.packages.map((dependency) => `${dependency.name}=${dependency.version}`).join(" "))' /build/debian-packages.lock.json)" \
 && apt-get install -y --no-install-recommends $package_args \
 && rm -rf /var/lib/apt/lists/*
COPY infra/docker/inventory-debian-packages.mjs /build/inventory-debian-packages.mjs
COPY infra/docker/verify-debian-packages.mjs /build/verify-debian-packages.mjs
RUN node /build/verify-debian-packages.mjs /build/debian-packages.lock.json

FROM api-debian-resolved AS build
ENV CI=true \
    npm_config_nodedir=/usr/local
COPY --from=node-runtime /usr/local/ /usr/local/
WORKDIR /src
RUN corepack enable pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm fetch --ignore-scripts --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter @opentrad/api...
RUN pnpm --filter @opentrad/api... build
RUN pnpm --filter @opentrad/api deploy --offline --ignore-scripts --prod /out \
 && find /out/src /out/tests -depth -delete

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && groupadd --gid 10001 opentrad-api \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin opentrad-api \
 && mkdir -p /run/opentrad /var/lib/opentrad \
 && chown 10001:10001 /run/opentrad \
 && chown 10001:10100 /var/lib/opentrad \
 && chmod 0700 /var/lib/opentrad
COPY --from=build --chown=10001:10001 /out/ ./
COPY --chown=10001:10001 infra/docker/api-entrypoint.sh /usr/local/bin/opentrad-api
RUN chmod 0555 /usr/local/bin/opentrad-api
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/opentrad-api"]
