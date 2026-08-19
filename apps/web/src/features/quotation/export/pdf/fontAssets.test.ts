import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webDirectory = process.cwd();
const fontDirectory = resolve(webDirectory, "public/fonts/source-han-sans-cn");

async function sha256(filename: string): Promise<string> {
  const contents = await readFile(`${fontDirectory}/${filename}`);
  return createHash("sha256").update(contents).digest("hex");
}

describe("pinned Source Han Sans CN assets", () => {
  it.each([
    [
      "SourceHanSansCN-Regular.otf",
      8_429_224,
      "e2bc8a2e7f37474b774fff8db758681ece40bb6947a90d571bce9dd60671a8e4",
    ],
    [
      "SourceHanSansCN-Bold.otf",
      8_569_308,
      "62383707c086a32f3afd5e293f34c7eff64c7fea31f579fdc6cbe34d920519a6",
    ],
  ])("keeps %s at the audited size and SHA-256", async (filename, size, hash) => {
    expect((await stat(`${fontDirectory}/${filename}`)).size).toBe(size);
    expect(await sha256(filename)).toBe(hash);
  });

  it("keeps the local OFL license and repository notice", async () => {
    const license = await readFile(`${fontDirectory}/LICENSE.txt`, "utf8");
    const notices = await readFile(resolve(webDirectory, "../../THIRD_PARTY_NOTICES.md"), "utf8");

    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(notices).toContain("Copyright 2014-2025 Adobe");
    expect(notices).toContain("Reserved Font Name 'Source'");
    expect(notices).toContain("Source is a trademark");
  });
});
