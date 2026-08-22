import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("host release tools are exact, checksummed, and narrowly installed", async () => {
  const lock = await readFile(new URL("infra/deploy/host-tools.lock", root), "utf8");
  const installer = await readFile(new URL("infra/deploy/install-host-tools.sh", root), "utf8");
  assert.match(lock, /^NODE_VERSION=24\.19\.0$/m);
  assert.match(lock, /^COSIGN_VERSION=3\.1\.3$/m);
  assert.equal(lock.match(/_SHA256=[a-f0-9]{64}$/gm)?.length, 2);
  assert.match(installer, /https:\/\/nodejs\.org\/dist\//);
  assert.match(installer, /https:\/\/github\.com\/sigstore\/cosign\/releases\/download\//);
  assert.match(installer, /sha256sum -c/);
  assert.match(installer, /--proto '=https'/);
  assert.match(installer, /--proto-redir '=https'/);
  assert.match(installer, /apt-get install[^\n]*sqlite3/);
  assert.doesNotMatch(installer, /curl[^\n]*\|\s*(?:ba)?sh/u);
  assert.doesNotMatch(installer, /apt-get\s+(?:upgrade|dist-upgrade)/u);
});
