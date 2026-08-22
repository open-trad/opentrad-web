#!/bin/sh
set -eu

pause() {
  printf '%s\n' "PAUSE_CLEANUP:$1" >&2
  exit 78
}

release_sha=${1:-}
printf '%s' "$release_sha" | grep -Eq '^[a-f0-9]{40}$' || pause INVALID_SHA
if test "${OPENTRAD_TEST_MODE:-0}" = 1; then
  test -n "${OPENTRAD_ROOT:-}" && test -n "${OPENTRAD_LIBEXEC:-}" || pause TEST_ROOT_MISSING
  opentrad_root=$OPENTRAD_ROOT
  libexec=$OPENTRAD_LIBEXEC
elif test "$(id -u)" -eq 0; then
  opentrad_root=/opt/opentrad
  libexec=/usr/local/libexec/opentrad
else
  pause ROOT_REQUIRED
fi

releases_root="$opentrad_root/releases"
current=$(node -e '
  const fs = require("node:fs");
  try { process.stdout.write(fs.realpathSync(process.argv[1])); } catch { process.exit(1); }
' "$opentrad_root/current") || pause CURRENT_UNRESOLVED
case "$current" in
  "$releases_root"/[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) ;;
  *) pause CURRENT_OUTSIDE_RELEASES ;;
esac
test "$(basename "$current")" = "$release_sha" || pause CURRENT_SHA_MISMATCH

trusted_verifier="$libexec/release/verify-manifest.mjs"
test -f "$trusted_verifier" || pause VERIFIER_MISSING
node - "$releases_root" "$current" "$trusted_verifier" <<'NODE'
const { readdirSync, rmSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { join, resolve } = require("node:path");
const root = resolve(process.argv[2]);
const current = resolve(process.argv[3]);
const verifier = resolve(process.argv[4]);
const sha = /^[a-f0-9]{40}$/u;
const candidates = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && sha.test(entry.name))
  .map((entry) => {
    const directory = join(root, entry.name);
    return { directory, modified: statSync(directory).mtimeMs };
  })
  .sort((left, right) => right.modified - left.modified);
const verified = candidates.filter(({ directory }) => {
  try {
    const manifest = join(directory, "release-manifest.json");
    const result = spawnSync(process.execPath, [verifier, manifest], {
      env: { PATH: process.env.PATH },
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
});
const keep = new Set([current]);
for (const candidate of verified) {
  if (keep.size >= 3) break;
  keep.add(resolve(candidate.directory));
}
for (const { directory } of candidates) {
  const target = resolve(directory);
  if (keep.has(target)) continue;
  if (!target.startsWith(`${root}/`) || !sha.test(require("node:path").basename(target))) {
    throw new Error("CLEANUP_TARGET_INVALID");
  }
  rmSync(target, { force: false, recursive: true });
}
NODE

printf '%s\n' "CLEANUP_OK:$release_sha"
