ARG DEBIAN_IMAGE
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS node-runtime

FROM node-runtime AS app-build
ENV CI=true
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/document-core/package.json packages/document-core/package.json
COPY packages/document-renderer/package.json packages/document-renderer/package.json
RUN pnpm fetch --ignore-scripts --frozen-lockfile
COPY infra/docker/node-artifacts.lock.json /build/node-artifacts.lock.json
COPY infra/docker/fetch-node-artifacts.mjs /build/fetch-node-artifacts.mjs
RUN node /build/fetch-node-artifacts.mjs /build/node-artifacts.lock.json /build/node-artifacts \
 && rm -rf /build/node-artifacts
COPY . .
RUN pnpm install --offline --frozen-lockfile --ignore-scripts --filter @opentrad/worker...
RUN pnpm --filter @opentrad/worker... build
RUN pnpm --filter @opentrad/worker deploy --offline --ignore-scripts --prod /out \
 && find /out/src /out/tests -depth -delete

FROM ${DEBIAN_IMAGE} AS debian-resolved
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY infra/docker/debian-packages.lock.json /build/debian-packages.lock.json
RUN sed -i 's|deb.debian.org/debian-security|mirrors.aliyun.com/debian-security|g; s|deb.debian.org/debian|mirrors.aliyun.com/debian|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && package_args="$(node -e 'const lock=require(process.argv[1]); process.stdout.write(lock.packages.map((dependency) => `${dependency.name}=${dependency.version}`).join(" "))' /build/debian-packages.lock.json)" \
 && apt-get install -y --no-install-recommends $package_args \
 && rm -rf /var/lib/apt/lists/*

FROM debian-resolved AS toolchain-base
COPY infra/docker/inventory-debian-packages.mjs /build/inventory-debian-packages.mjs
COPY infra/docker/verify-debian-packages.mjs /build/verify-debian-packages.mjs
RUN node /build/verify-debian-packages.mjs /build/debian-packages.lock.json
COPY infra/docker/toolchain.lock.json /build/toolchain.lock.json
COPY infra/docker/fetch-toolchain.mjs /build/fetch-toolchain.mjs
RUN node /build/fetch-toolchain.mjs --download /build/toolchain.lock.json /build/downloads \
 && cd /build/downloads \
 && sha256sum -c SHA256SUMS \
 && node /build/fetch-toolchain.mjs --install /build/toolchain.lock.json /build/toolchain
COPY infra/docker/python-requirements.lock /build/python-requirements.lock
RUN python3 -m pip install --break-system-packages --require-hashes --only-binary=:all: \
      --no-cache-dir --prefix=/build/toolchain/root/opt/opentrad-tools \
      --requirement /build/python-requirements.lock
COPY infra/docker/tessdata.lock.json /build/tessdata.lock.json
RUN node /build/fetch-toolchain.mjs --download-data /build/tessdata.lock.json /build/tessdata \
 && cd /build/tessdata \
 && sha256sum -c SHA256SUMS \
 && mkdir -p /build/toolchain/root/opt/opentrad-tools/share/tessdata \
 && cp ./*.traineddata /build/toolchain/root/opt/opentrad-tools/share/tessdata/
RUN cd /build/toolchain/src/tesseract \
 && ./autogen.sh \
 && ./configure --prefix=/opt/opentrad-tools \
 && make -j2 \
 && make DESTDIR=/build/toolchain/root install
RUN cmake -S /build/toolchain/src/qpdf -B /build/qpdf \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/opentrad-tools \
      -DBUILD_SHARED_LIBS=ON -DBUILD_STATIC_LIBS=OFF -DBUILD_DOC=OFF \
 && cmake --build /build/qpdf --parallel 2 \
 && DESTDIR=/build/toolchain/root cmake --install /build/qpdf
COPY infra/docker/cmake.lock.json /build/cmake.lock.json
COPY infra/docker/fetch-cmake.mjs /build/fetch-cmake.mjs
RUN node /build/fetch-cmake.mjs /build/cmake.lock.json /build/cmake \
 && /build/cmake/bin/cmake --version | head -n 1 | grep -F '3.31.10'
COPY infra/docker/freetype.lock.json /build/freetype.lock.json
COPY infra/docker/fetch-freetype.mjs /build/fetch-freetype.mjs
RUN node /build/fetch-freetype.mjs /build/freetype.lock.json /build/freetype \
 && cd /build/freetype \
 && ./configure --prefix=/opt/opentrad-tools \
 && make -j2 \
 && make DESTDIR=/build/toolchain/root install
COPY infra/docker/expat.lock.json /build/expat.lock.json
COPY infra/docker/fetch-expat.mjs /build/fetch-expat.mjs
RUN node /build/fetch-expat.mjs /build/expat.lock.json /build/expat \
 && cd /build/expat \
 && ./configure --prefix=/opt/opentrad-tools \
 && make -j2 \
 && make DESTDIR=/build/toolchain/root install
COPY infra/docker/gperf.lock.json /build/gperf.lock.json
COPY infra/docker/fetch-gperf.mjs /build/fetch-gperf.mjs
RUN node /build/fetch-gperf.mjs /build/gperf.lock.json /build/gperf \
 && cd /build/gperf \
 && ./configure --prefix=/build/gperf-install \
 && make -j2 \
 && make install
COPY infra/docker/fontconfig.lock.json /build/fontconfig.lock.json
COPY infra/docker/fetch-fontconfig.mjs /build/fetch-fontconfig.mjs
RUN node /build/fetch-fontconfig.mjs /build/fontconfig.lock.json /build/fontconfig \
 && cd /build/fontconfig \
 && export PATH=/build/gperf-install/bin:$PATH \
 && FREETYPE_CFLAGS=-I/build/toolchain/root/opt/opentrad-tools/include/freetype2 \
      FREETYPE_LIBS='-L/build/toolchain/root/opt/opentrad-tools/lib -lfreetype' \
      EXPAT_CFLAGS=-I/build/toolchain/root/opt/opentrad-tools/include \
      EXPAT_LIBS='-L/build/toolchain/root/opt/opentrad-tools/lib -lexpat' \
      ./configure --prefix=/opt/opentrad-tools \
 && make -j2 \
 && make DESTDIR=/build/toolchain/root install

FROM toolchain-base AS toolchain
COPY infra/docker/poppler-build-packages.lock.json /build/poppler-build-packages.lock.json
COPY infra/docker/verify-poppler-build-packages.mjs /build/verify-poppler-build-packages.mjs
RUN apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 update \
 && package_args="$(node -e 'const lock=require(process.argv[1]); process.stdout.write(lock.packages.map((poppler_dependency) => `${poppler_dependency.name}=${poppler_dependency.version}`).join(" "))' /build/poppler-build-packages.lock.json)" \
 && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 install -y --no-install-recommends $package_args \
 && node /build/verify-poppler-build-packages.mjs /build/poppler-build-packages.lock.json \
 && rm -rf /var/lib/apt/lists/*
RUN /build/cmake/bin/cmake -S /build/toolchain/src/poppler -B /build/poppler \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/opentrad-tools \
      -DCMAKE_PREFIX_PATH=/build/toolchain/root/opt/opentrad-tools \
      -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF \
      -DENABLE_UTILS=ON -DENABLE_LIBJPEG=ON -DENABLE_LIBOPENJPEG=ON -DENABLE_LCMS=ON \
      -DENABLE_QT5=OFF -DENABLE_QT6=OFF -DENABLE_GLIB=OFF -DENABLE_CPP=OFF \
      -DENABLE_NSS3=OFF -DENABLE_GPGME=OFF -DENABLE_LIBCURL=OFF -DENABLE_BOOST=OFF \
 && /build/cmake/bin/cmake --build /build/poppler --parallel 2 \
 && DESTDIR=/build/toolchain/root /build/cmake/bin/cmake --install /build/poppler
RUN export PKG_CONFIG_PATH=/build/toolchain/root/opt/opentrad-tools/lib/pkgconfig \
      CMAKE_PREFIX_PATH=/build/toolchain/root/opt/opentrad-tools \
      CPATH=/build/toolchain/root/opt/opentrad-tools/include \
      LIBRARY_PATH=/build/toolchain/root/opt/opentrad-tools/lib \
      LD_LIBRARY_PATH=/build/toolchain/root/opt/opentrad-tools/lib \
 && meson setup /build/vips /build/toolchain/src/libvips \
      --buildtype=release --prefix=/opt/opentrad-tools \
 && meson compile -C /build/vips -j 2 \
 && DESTDIR=/build/toolchain/root meson install -C /build/vips

FROM ${DEBIAN_IMAGE} AS runtime
ENV HOME=/run/opentrad \
    XDG_CACHE_HOME=/run/opentrad/cache \
    TMPDIR=/work \
    PYTHONPATH=/opt/opentrad-tools/lib/python3.11/site-packages \
    TESSDATA_PREFIX=/opt/opentrad-tools/share/tessdata \
    PATH=/opt/opentrad-tools/bin:/opt/libreoffice26.2/program:/usr/local/bin:/usr/bin:/bin \
    LD_LIBRARY_PATH=/opt/opentrad-tools/lib:/opt/libreoffice26.2/program
RUN mkdir -p /run/opentrad /work \
 && chown -R 10002:10002 /run/opentrad /work
COPY --from=toolchain /build/toolchain/root/ /
COPY --from=toolchain /usr/lib /usr/lib
COPY --from=toolchain /usr/share /usr/share
COPY --from=toolchain /usr/bin/python3 /usr/bin/python3
COPY --from=toolchain /usr/bin/python3.11 /usr/bin/python3.11
COPY --from=toolchain /usr/bin/gs /usr/bin/gs
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=app-build --chown=10002:10002 /out/dist /app
COPY --from=app-build --chown=10002:10002 /out/node_modules /app/node_modules
COPY --chown=10002:10002 infra/docker/worker-entrypoint.sh /usr/local/bin/opentrad-worker
RUN chmod 0555 /usr/local/bin/opentrad-worker
USER 10002:10002
ENTRYPOINT ["/usr/local/bin/opentrad-worker"]
