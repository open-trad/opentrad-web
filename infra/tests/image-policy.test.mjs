import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("base images are digest pinned", () => {
  const lines = readFileSync(new URL("infra/docker/base-images.lock", root), "utf8")
    .trim()
    .split("\n");
  assert.deepEqual(
    lines.map((line) => line.split("=")[0]),
    ["NODE_IMAGE", "DEBIAN_IMAGE", "CLAMAV_IMAGE", "NGINX_IMAGE"],
  );
  for (const line of lines) {
    assert.match(line, /^[A-Z_]+=.+@sha256:[a-f0-9]{64}$/);
  }
});

test("Debian runtime base includes the current Bookworm security point release", () => {
  const lock = readFileSync(new URL("infra/docker/base-images.lock", root), "utf8");
  const resolver = readFileSync(new URL("infra/docker/resolve-locks.mjs", root), "utf8");
  const verifier = readFileSync(new URL("infra/docker/verify-locks.mjs", root), "utf8");

  assert.match(lock, /^DEBIAN_IMAGE=debian:12\.15-slim@sha256:[a-f0-9]{64}$/m);
  assert.match(resolver, /\["DEBIAN_IMAGE", "debian:12\.15-slim"\]/);
  assert.match(verifier, /\["DEBIAN_IMAGE", "debian:12\.15-slim"\]/);
});

test("toolchain versions and checksums are exact", () => {
  const lock = JSON.parse(readFileSync(new URL("infra/docker/toolchain.lock.json", root), "utf8"));
  assert.deepEqual(Object.fromEntries(lock.tools.map((tool) => [tool.id, tool.version])), {
    libreoffice: "26.2.5",
    pandoc: "3.10.2",
    ocrmypdf: "17.10.0",
    tesseract: "5.5.3",
    qpdf: "12.4.0",
    poppler: "26.08.0",
    libvips: "8.18.5",
    clamav: "1.5.4",
  });
  for (const tool of lock.tools) {
    assert.match(tool.source, /^https:\/\/[a-z0-9./_~%-]+$/i);
    assert.match(tool.sha256, /^[a-f0-9]{64}$/);
    assert.ok(tool.license.length > 2);
  }
});

test("API and worker Dockerfiles use locked bases and numeric non-root users", () => {
  const api = readFileSync(new URL("infra/docker/api.Dockerfile", root), "utf8");
  const worker = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");

  assert.match(api, /^ARG DEBIAN_IMAGE\nARG NODE_IMAGE\nFROM \$\{NODE_IMAGE\} AS node-runtime/m);
  assert.match(worker, /^ARG DEBIAN_IMAGE\nARG NODE_IMAGE\nFROM \$\{NODE_IMAGE\} AS node-runtime/m);
  assert.match(api, /FROM api-debian-resolved AS build\nENV CI=true/);
  assert.match(api, /FROM \$\{DEBIAN_IMAGE\} AS api-debian-resolved/);
  assert.match(worker, /FROM node-runtime AS app-build\nENV CI=true/);
  assert.match(worker, /FROM \$\{DEBIAN_IMAGE\} AS debian-resolved/);
  assert.doesNotMatch(`${api}\n${worker}`, /(?:^|[/:])latest(?:$|\s)/im);
  assert.match(api, /USER 10001:10001\s*\nENTRYPOINT/);
  assert.match(worker, /USER 10002:10002\s*\nENTRYPOINT/);
});

test("image definitions preserve the read-only runtime boundary", () => {
  const files = [
    "infra/docker/api.Dockerfile",
    "infra/docker/worker.Dockerfile",
    "infra/docker/api-entrypoint.sh",
    "infra/docker/worker-entrypoint.sh",
  ].map((path) => readFileSync(new URL(path, root), "utf8"));
  const combined = files.join("\n");

  assert.doesNotMatch(combined, /curl\s+[^\n|]*\|\s*(?:ba)?sh/);
  assert.doesNotMatch(combined, /\/var\/run\/docker\.sock|id_rsa|\.ssh\//);
  assert.doesNotMatch(
    files[0].split(/^FROM \$\{NODE_IMAGE\} AS runtime$/m)[1],
    /(?:apt|apk|dnf|yum)(?:-get)?\s+install/,
  );
  assert.doesNotMatch(
    files[1].split(/^FROM \$\{DEBIAN_IMAGE\} AS runtime$/m)[1],
    /(?:apk|dnf|yum)\s+install/,
  );
  assert.match(files[0], /mkdir -p \/run\/opentrad/);
  assert.match(files[1], /mkdir -p \/run\/opentrad \/work/);
});

test("worker verifies every runtime tool before starting its current entry point", () => {
  const entrypoint = readFileSync(new URL("infra/docker/worker-entrypoint.sh", root), "utf8");
  const scratchSetup = entrypoint.indexOf("install -d -m 0700 /work/home /work/tmp");
  const firstProbe = entrypoint.indexOf("/usr/bin/soffice --version");
  assert.ok(scratchSetup >= 0, "worker must create private scratch directories in the tmpfs");
  assert.ok(scratchSetup < firstProbe, "scratch directories must exist before tool verification");
  for (const probe of [
    "/usr/bin/soffice --version | grep -F '26.2.5'",
    "pandoc --version | head -n 1 | grep -F '3.10.2'",
    "ocrmypdf --version 2>&1 | grep -F '17.10.0'",
    "tesseract --version 2>&1 | head -n 1 | grep -F '5.5.3'",
    "qpdf --version | grep -F '12.4.0'",
    "pdftoppm -v 2>&1 | grep -F '26.08.0'",
    "vips --version | grep -F '8.18.5'",
  ]) {
    assert.ok(entrypoint.includes(probe), `missing probe: ${probe}`);
  }
  assert.match(entrypoint, /exec node \/app\/main\.js\s*$/);
});

test("worker exposes the locked OCRmyPDF prefix to Python and the executable path", () => {
  const worker = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(worker, /PYTHONPATH=\/opt\/opentrad-tools\/local\/lib\/python3\.11\/dist-packages/);
  assert.match(worker, /PATH=\/opt\/opentrad-tools\/local\/bin:/);
  assert.match(
    worker,
    /LD_LIBRARY_PATH=\/opt\/opentrad-tools\/lib\/x86_64-linux-gnu:\/opt\/opentrad-tools\/lib:/,
  );
});

test("worker runtime excludes build-only system setuptools", () => {
  const worker = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  const runtime = worker.split(/^FROM \$\{DEBIAN_IMAGE\} AS runtime$/m)[1];

  assert.ok(runtime, "worker runtime stage must exist");
  for (const path of [
    "/usr/lib/python3/dist-packages/setuptools",
    "/usr/lib/python3/dist-packages/setuptools-*.egg-info",
    "/usr/lib/python3/dist-packages/pkg_resources",
    "/usr/lib/python3/dist-packages/_distutils_hack",
    "/usr/lib/python3/dist-packages/distutils-precedence.pth",
  ]) {
    assert.ok(runtime.includes(path), `worker runtime must remove ${path}`);
  }
});

test("worker exposes the absolute tool paths enforced by its runtime policy", () => {
  const worker = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  const links = [
    ["/opt/opentrad-tools/bin/pandoc", "/usr/bin/pandoc"],
    ["/opt/opentrad-tools/bin/pdfinfo", "/usr/bin/pdfinfo"],
    ["/opt/opentrad-tools/bin/pdftoppm", "/usr/bin/pdftoppm"],
    ["/opt/opentrad-tools/bin/pdftotext", "/usr/bin/pdftotext"],
    ["/opt/opentrad-tools/bin/qpdf", "/usr/bin/qpdf"],
    ["/opt/opentrad-tools/bin/tesseract", "/usr/bin/tesseract"],
    ["/opt/opentrad-tools/bin/vips", "/usr/bin/vips"],
  ];
  for (const [source, target] of links) {
    assert.ok(worker.includes(`ln -s ${source} ${target}`), `missing policy link: ${target}`);
  }
  assert.match(worker, /COPY infra\/docker\/ocrmypdf-wrapper\.sh \/opt\/ocr\/bin\/ocrmypdf/);
  assert.match(worker, /COPY infra\/docker\/soffice-wrapper\.sh \/usr\/bin\/soffice/);
  assert.match(worker, /\/etc\/ld\.so\.conf\.d\/opentrad-tools\.conf/);
  assert.match(worker, /&& \/sbin\/ldconfig/);

  const ocrmypdfWrapper = readFileSync(new URL("infra/docker/ocrmypdf-wrapper.sh", root), "utf8");
  assert.match(
    ocrmypdfWrapper,
    /PYTHONPATH=\/opt\/opentrad-tools\/local\/lib\/python3\.11\/dist-packages/,
  );
  assert.match(ocrmypdfWrapper, /exec \/opt\/opentrad-tools\/local\/bin\/ocrmypdf "\$@"/);

  const sofficeWrapper = readFileSync(new URL("infra/docker/soffice-wrapper.sh", root), "utf8");
  assert.match(sofficeWrapper, /LibreOffice 26\.2\.5\.2 cd7284b4cbbfeb507e630c1aac019f4157393acb/);
  assert.match(sofficeWrapper, /printf '%s\\n' 'LibreOffice 26\.2\.5'/);
  assert.match(sofficeWrapper, /exec \/opt\/libreoffice26\.2\/program\/soffice "\$@"/);
});

test("worker downloads only lock-declared artifacts and verifies them before extraction", () => {
  const worker = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(worker, /COPY infra\/docker\/toolchain\.lock\.json/);
  assert.match(worker, /COPY infra\/docker\/worker-runtime-packages\.lock\.json/);
  assert.match(worker, /verify-runtime-packages\.mjs/);
  assert.match(worker, /fetch-toolchain\.mjs --download/);
  assert.match(worker, /sha256sum -c/);
  assert.match(worker, /fetch-toolchain\.mjs --install/);
  assert.match(worker, /pip install[^\n]*--require-hashes[^\n]*--only-binary=:all:/);
  assert.match(worker, /-DBUILD_SHARED_LIBS=ON -DBUILD_STATIC_LIBS=OFF -DBUILD_DOC=OFF/);
  assert.match(worker, /\/build\/cmake\/bin\/cmake -S \/build\/toolchain\/src\/poppler/);
  assert.match(
    worker,
    /PKG_CONFIG_PATH=\/build\/toolchain\/root\/opt\/opentrad-tools\/lib\/pkgconfig/,
  );
  assert.match(worker, /CMAKE_PREFIX_PATH=\/build\/toolchain\/root\/opt\/opentrad-tools/);
  assert.match(worker, /CPATH=\/build\/toolchain\/root\/opt\/opentrad-tools\/include/);
  assert.match(worker, /LIBRARY_PATH=\/build\/toolchain\/root\/opt\/opentrad-tools\/lib/);
  assert.doesNotMatch(worker, /PKG_CONFIG_SYSROOT_DIR=/);
  assert.match(worker, /RUN export PKG_CONFIG_PATH=/);
  for (const option of [
    "-DENABLE_UTILS=ON",
    "-DENABLE_LIBJPEG=ON",
    "-DENABLE_LIBOPENJPEG=ON",
    "-DENABLE_LCMS=ON",
    "-DENABLE_NSS3=OFF",
    "-DENABLE_GPGME=OFF",
    "-DENABLE_LIBCURL=OFF",
    "-DENABLE_BOOST=OFF",
    "-DENABLE_CPP=OFF",
  ]) {
    assert.ok(worker.includes(option), `missing explicit Poppler feature option: ${option}`);
  }
});

test("API deployment uses the current package layout and excludes source and tests", () => {
  const dockerfile = readFileSync(new URL("infra/docker/api.Dockerfile", root), "utf8");
  const entrypoint = readFileSync(new URL("infra/docker/api-entrypoint.sh", root), "utf8");
  assert.match(
    dockerfile,
    /pnpm --filter @opentrad\/api deploy --offline --ignore-scripts --prod \/out/,
  );
  assert.doesNotMatch(dockerfile, /deploy --legacy/);
  assert.match(dockerfile, /find \/out\/src \/out\/tests -depth -delete/);
  assert.match(entrypoint, /if test "\$#" -gt 0; then\s+exec "\$@"\s+fi/);
  assert.match(entrypoint, /exec node \/app\/dist\/server\.js\s*$/);
  assert.match(dockerfile, /pnpm fetch --ignore-scripts --frozen-lockfile/);
  assert.match(dockerfile, /npm_config_nodedir=\/usr\/local/);
  assert.match(dockerfile, /COPY infra\/docker\/debian-packages\.lock\.json/);
  assert.match(dockerfile, /verify-debian-packages\.mjs/);
  assert.match(dockerfile, /RUN corepack enable pnpm/);
  assert.match(
    dockerfile,
    /pnpm install --offline --frozen-lockfile --filter @opentrad\/api\.\.\./,
  );
  assert.match(dockerfile, /mkdir -p \/run\/opentrad \/var\/lib\/opentrad/);
  assert.match(dockerfile, /chown 10001:10100 \/var\/lib\/opentrad/);
  assert.match(dockerfile, /chmod 0700 \/var\/lib\/opentrad/);
});

test("API runtime removes build-only package managers and their bundled dependencies", () => {
  const dockerfile = readFileSync(new URL("infra/docker/api.Dockerfile", root), "utf8");
  const runtime = dockerfile.split(/^FROM \$\{NODE_IMAGE\} AS runtime$/m)[1];

  assert.ok(runtime, "API runtime stage must exist");
  for (const path of [
    "/usr/local/lib/node_modules/npm",
    "/usr/local/lib/node_modules/corepack",
    "/usr/local/bin/npm",
    "/usr/local/bin/npx",
    "/usr/local/bin/corepack",
  ]) {
    assert.ok(runtime.includes(path), `API runtime must remove ${path}`);
  }
});

test("worker gets Node 24 only from the digest-locked Node image", () => {
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(
    dockerfile,
    /^ARG DEBIAN_IMAGE\nARG NODE_IMAGE\nFROM \$\{NODE_IMAGE\} AS node-runtime/m,
  );
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS node-runtime/);
  assert.match(dockerfile, /FROM \$\{DEBIAN_IMAGE\} AS runtime/);
  assert.match(
    dockerfile,
    /COPY --from=node-runtime \/usr\/local\/bin\/node \/usr\/local\/bin\/node/,
  );
  assert.doesNotMatch(dockerfile, /apt-get install[^\n]*\bnodejs\b/);
});

test("worker deploys the current workspace package with production dependencies", () => {
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /pnpm fetch --ignore-scripts --frozen-lockfile/);
  assert.match(
    dockerfile,
    /pnpm install --offline --frozen-lockfile --ignore-scripts --filter @opentrad\/worker\.\.\./,
  );
  assert.match(dockerfile, /pnpm --filter @opentrad\/worker\.\.\. build/);
  assert.match(
    dockerfile,
    /pnpm --filter @opentrad\/worker deploy --offline --ignore-scripts --prod \/out/,
  );
  assert.doesNotMatch(dockerfile, /deploy --legacy/);
  assert.match(dockerfile, /COPY --from=app-build --chown=10002:10002 \/out\/dist \/app/);
  assert.match(
    dockerfile,
    /COPY --from=app-build --chown=10002:10002 \/out\/node_modules \/app\/node_modules/,
  );
});

test("worker prefetches the external SheetJS tarball through an exact checksum lock", () => {
  const lock = JSON.parse(
    readFileSync(new URL("infra/docker/node-artifacts.lock.json", root), "utf8"),
  );
  assert.deepEqual(lock, {
    schemaVersion: 1,
    artifacts: [
      {
        id: "xlsx",
        version: "0.20.3",
        source: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
        sha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
        pnpmIntegrity:
          "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
      },
    ],
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/node-artifacts\.lock\.json/);
  assert.match(dockerfile, /fetch-node-artifacts\.mjs/);
  assert.doesNotMatch(dockerfile, /pnpm store add|prime-pnpm-url-cache/);
  assert.match(dockerfile, /deploy --offline --ignore-scripts --prod/);
});

test("API derives one exact trusted proxy gateway only when unset", () => {
  const entrypoint = readFileSync(new URL("infra/docker/api-entrypoint.sh", root), "utf8");
  assert.match(entrypoint, /OPENTRAD_TRUSTED_PROXY_CIDR/);
  assert.match(entrypoint, /\/proc\/net\/route/);
  assert.match(entrypoint, /PAUSE_RUNTIME:TRUSTED_PROXY_UNAVAILABLE/);
  assert.match(entrypoint, /export OPENTRAD_TRUSTED_PROXY_CIDR="\$trusted_proxy_gateway\/32"/);
});

test("Debian package closure is exact and verified inside the build", () => {
  const lock = JSON.parse(
    readFileSync(new URL("infra/docker/debian-packages.lock.json", root), "utf8"),
  );
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.architecture, "amd64");
  assert.ok(lock.packages.length > 100);
  assert.deepEqual(
    lock.packages.map(({ name }) => name),
    [...lock.packages.map(({ name }) => name)].sort(),
  );
  for (const dependency of lock.packages) {
    assert.match(dependency.name, /^[a-z0-9][a-z0-9+.-]+$/);
    assert.ok(dependency.version.length > 0);
    assert.match(dependency.architecture, /^(?:all|amd64)$/);
    assert.match(dependency.md5ManifestSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(
    lock.packages.find(({ name }) => name === "libopenjp2-7-dev"),
    undefined,
  );
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/debian-packages\.lock\.json/);
  assert.match(dockerfile, /COPY infra\/docker\/inventory-debian-packages\.mjs/);
  assert.match(dockerfile, /verify-debian-packages\.mjs/);
  assert.match(dockerfile, /dependency\.name}=\$\{dependency\.version}/);
});

test("Poppler build-only packages have a late exact lock and bounded resolver", () => {
  const lock = JSON.parse(
    readFileSync(new URL("infra/docker/poppler-build-packages.lock.json", root), "utf8"),
  );
  assert.deepEqual(lock, {
    schemaVersion: 1,
    architecture: "amd64",
    packages: [
      {
        name: "liblcms2-dev",
        version: "2.14-2+deb12u1",
        architecture: "amd64",
        md5ManifestSha256: "41c748511463b4139952484001e2dc2257149741a3cecafc83e90c22ef7fd53f",
      },
      {
        name: "libopenjp2-7-dev",
        version: "2.5.0-2+deb12u3",
        architecture: "amd64",
        md5ManifestSha256: "ba67062afca20cf6965fc41090417dea794923a9d32997538a47ac5edb4ea22f",
      },
    ],
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  const fontconfigBuild = dockerfile.indexOf("node /build/fetch-fontconfig.mjs");
  const lateStage = dockerfile.indexOf("FROM toolchain-base AS toolchain");
  const popplerBuild = dockerfile.indexOf("/build/toolchain/src/poppler");
  assert.ok(fontconfigBuild >= 0 && fontconfigBuild < lateStage && lateStage < popplerBuild);
  assert.match(dockerfile, /COPY infra\/docker\/poppler-build-packages\.lock\.json/);
  assert.match(dockerfile, /verify-poppler-build-packages\.mjs/);
  assert.match(dockerfile, /Acquire::Retries=3/);
  assert.match(dockerfile, /Acquire::http::Timeout=30/);
  assert.match(dockerfile, /Acquire::https::Timeout=30/);
  assert.match(dockerfile, /poppler_dependency\.name}=\$\{poppler_dependency\.version}/);
});

test("OCR and language data inputs are checksum locked", () => {
  const pythonLock = readFileSync(new URL("infra/docker/python-requirements.lock", root), "utf8");
  assert.match(pythonLock, /^ocrmypdf==17\.10\.0 \\/m);
  assert.equal((pythonLock.match(/^[a-zA-Z0-9_.-]+==/gm) ?? []).length, 27);
  assert.doesNotMatch(pythonLock, /--index-url|--extra-index-url|-e\s/);
  for (const line of pythonLock.split("\n").filter((value) => value.includes("--hash="))) {
    assert.match(line, /--hash=sha256:[a-f0-9]{64}/);
  }
  const dataLock = JSON.parse(
    readFileSync(new URL("infra/docker/tessdata.lock.json", root), "utf8"),
  );
  assert.deepEqual(
    dataLock.files.map(({ id }) => id),
    ["chi_sim", "eng", "osd"],
  );
  for (const entry of dataLock.files) {
    assert.match(
      entry.source,
      /^https:\/\/raw\.githubusercontent\.com\/tesseract-ocr\/tessdata_fast\/[a-f0-9]{40}\//,
    );
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/python-requirements\.lock/);
  assert.match(dockerfile, /pip install[^\n]*--require-hashes[^\n]*--only-binary=:all:/);
  assert.match(dockerfile, /COPY infra\/docker\/tessdata\.lock\.json/);
  assert.match(dockerfile, /fetch-toolchain\.mjs --download-data/);
  assert.match(dockerfile, /TESSDATA_PREFIX=\/opt\/opentrad-tools\/share\/tessdata/);
});

test("Nginx syntax checks consume only the digest-locked image", () => {
  const script = readFileSync(new URL("infra/nginx/test-nginx.sh", root), "utf8");
  assert.match(script, /\. "\$repository_root\/infra\/docker\/base-images\.lock"/);
  assert.match(script, /docker image inspect "\$NGINX_IMAGE"/);
  assert.match(script, /docker run --rm --platform linux\/amd64 --pull=never/);
  assert.doesNotMatch(script, /docker (?:pull|run)[^\n]*nginx:1\.22\.1/);
});

test("release uploads complete Trivy evidence before enforcing the vulnerability gate", () => {
  const workflow = readFileSync(new URL(".github/workflows/release-images.yml", root), "utf8");
  const upload = workflow.indexOf("name: Upload Trivy scan evidence");
  const gate = workflow.indexOf("name: Fail on high or critical findings");

  assert.ok(upload >= 0, "release must upload Trivy evidence");
  assert.ok(upload < gate, "Trivy evidence must be retained before a failing policy gate");
  const evidenceStep = workflow.slice(upload, gate);
  assert.match(evidenceStep, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(
    evidenceStep,
    /path: \|\s+trivy-api\.json\s+trivy-worker\.json\s+trivy-clamav\.json/,
  );
  assert.match(evidenceStep, /retention-days: 30/);
});

test("release verifies the exact built runtime images before scanning them", () => {
  const workflow = readFileSync(new URL(".github/workflows/release-images.yml", root), "utf8");
  const verify = workflow.indexOf("name: Verify built runtime images");
  const scan = workflow.indexOf("name: Scan API runtime image");

  assert.ok(verify >= 0, "release must verify the built runtime images");
  assert.ok(verify < scan, "runtime verification must complete before vulnerability scans");
  const verifyStep = workflow.slice(verify, scan);
  assert.match(
    verifyStep,
    /API_IMAGE: \$\{\{ env\.API_REPOSITORY \}\}@\$\{\{ steps\.api\.outputs\.digest \}\}/,
  );
  assert.match(
    verifyStep,
    /WORKER_IMAGE: \$\{\{ env\.WORKER_REPOSITORY \}\}@\$\{\{ steps\.worker\.outputs\.digest \}\}/,
  );
  assert.match(verifyStep, /sh infra\/docker\/verify-images\.sh "\$API_IMAGE" "\$WORKER_IMAGE"/);
});

test("final worker image verification executes the compiled startup toolchain policy", () => {
  const entrypoint = readFileSync(new URL("infra/docker/worker-entrypoint.sh", root), "utf8");
  const verifyOnly = entrypoint.indexOf('test "${OPENTRAD_VERIFY_ONLY:-false}" = true');
  const productionStart = entrypoint.indexOf("exec node /app/main.js");

  assert.ok(verifyOnly >= 0, "worker entrypoint must retain verify-only mode");
  assert.ok(verifyOnly < productionStart, "verify-only policy must run before production startup");
  assert.match(entrypoint, /await import\("\/app\/toolchain\.js"\)/);
  assert.match(entrypoint, /await verifyToolchain\(\)/);
});

test("Poppler's newer CMake input has an independent exact lock", () => {
  const lock = JSON.parse(readFileSync(new URL("infra/docker/cmake.lock.json", root), "utf8"));
  assert.deepEqual(lock, {
    schemaVersion: 1,
    id: "cmake",
    version: "3.31.10",
    source:
      "https://github.com/Kitware/CMake/releases/download/v3.31.10/cmake-3.31.10-linux-x86_64.tar.gz",
    license: "BSD-3-Clause",
    sha256: "3cb3dd247b6a1de2d0f4b20c6fd4326c9024e894cebc9dc8699758887e566ca7",
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/cmake\.lock\.json/);
  assert.match(
    dockerfile,
    /node \/build\/fetch-cmake\.mjs \/build\/cmake\.lock\.json \/build\/cmake/,
  );
  assert.match(dockerfile, /cmake --version \| head -n 1 \| grep -F '3\.31\.10'/);
});

test("Poppler's newer FreeType input has an independent exact lock", () => {
  const lock = JSON.parse(readFileSync(new URL("infra/docker/freetype.lock.json", root), "utf8"));
  assert.deepEqual(lock, {
    schemaVersion: 1,
    id: "freetype",
    version: "2.13.3",
    source: "https://download-mirror.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz",
    license: "FTL OR GPL-2.0-only",
    sha256: "0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289",
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/freetype\.lock\.json/);
  assert.match(
    dockerfile,
    /node \/build\/fetch-freetype\.mjs \/build\/freetype\.lock\.json \/build\/freetype/,
  );
  assert.match(dockerfile, /-DCMAKE_PREFIX_PATH=\/build\/toolchain\/root\/opt\/opentrad-tools/);
});

test("Poppler's newer Fontconfig input has an independent exact lock", () => {
  const lock = JSON.parse(readFileSync(new URL("infra/docker/fontconfig.lock.json", root), "utf8"));
  assert.deepEqual(lock, {
    schemaVersion: 1,
    id: "fontconfig",
    version: "2.15.0",
    source: "https://github.com/fontconfig/fontconfig/archive/refs/tags/2.15.0.tar.gz",
    license: "MIT",
    sha256: "cdebb4b805d33e9bdefcc0ef9743db638d2acb21139bbe1a6a85878d4c3e8c9e",
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/fontconfig\.lock\.json/);
  assert.match(
    dockerfile,
    /node \/build\/fetch-fontconfig\.mjs \/build\/fontconfig\.lock\.json \/build\/fontconfig/,
  );
  assert.match(dockerfile, /meson setup \/build\/fontconfig-build \/build\/fontconfig/);
  assert.match(dockerfile, /-Dnls=disabled -Ddoc=disabled -Dtests=disabled/);
  assert.match(
    dockerfile,
    /CFLAGS='-I\/build\/toolchain\/root\/opt\/opentrad-tools\/include\/freetype2/,
  );
});

test("Fontconfig's Expat headers come from an independent exact lock", () => {
  const lock = JSON.parse(readFileSync(new URL("infra/docker/expat.lock.json", root), "utf8"));
  assert.deepEqual(lock, {
    schemaVersion: 1,
    id: "expat",
    version: "2.7.1",
    source: "https://github.com/libexpat/libexpat/releases/download/R_2_7_1/expat-2.7.1.tar.xz",
    license: "MIT",
    sha256: "354552544b8f99012e5062f7d570ec77f14b412a3ff5c7d8d0dae62c0d217c30",
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/expat\.lock\.json/);
  assert.match(
    dockerfile,
    /node \/build\/fetch-expat\.mjs \/build\/expat\.lock\.json \/build\/expat/,
  );
  assert.match(
    dockerfile,
    /PKG_CONFIG_PATH=\/build\/toolchain\/root\/opt\/opentrad-tools\/lib\/pkgconfig/,
  );
});

test("Fontconfig's gperf generator comes from an independent exact lock", () => {
  const lock = JSON.parse(readFileSync(new URL("infra/docker/gperf.lock.json", root), "utf8"));
  assert.deepEqual(lock, {
    schemaVersion: 1,
    id: "gperf",
    version: "3.1",
    source: "https://ftp.gnu.org/gnu/gperf/gperf-3.1.tar.gz",
    license: "GPL-3.0-or-later",
    sha256: "588546b945bba4b70b6a3a616e80b4ab466e3f33024a352fc2198112cdbb3ae2",
  });
  const dockerfile = readFileSync(new URL("infra/docker/worker.Dockerfile", root), "utf8");
  assert.match(dockerfile, /COPY infra\/docker\/gperf\.lock\.json/);
  assert.match(
    dockerfile,
    /node \/build\/fetch-gperf\.mjs \/build\/gperf\.lock\.json \/build\/gperf/,
  );
  assert.match(dockerfile, /export PATH=\/build\/gperf-install\/bin:\$PATH/);
});
