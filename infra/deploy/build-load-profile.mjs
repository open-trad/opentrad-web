#!/usr/bin/env node
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const services = Object.freeze([
  Object.freeze({
    containerName: "openvac-production-web-1",
    id: "openvac-web",
    url: "https://openvac.cn/",
  }),
  Object.freeze({
    containerName: "paperbanana-hk-auth-gateway-1",
    id: "paperbanana-auth",
    url: "https://api.paperbanana.asia/",
  }),
  Object.freeze({
    containerName: "tensor-auto-web-1",
    id: "tensor-auto-web",
    url: "https://tensor-auto.dns.army/",
  }),
  Object.freeze({
    containerName: "tensor-auto-api-1",
    id: "tensor-auto-api",
    url: "https://tensor-auto.dns.army/",
  }),
]);

export function buildLoadProfile(baseline) {
  if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) {
    throw new Error("BASELINE_INVALID");
  }
  return Object.freeze({
    existingServices: Object.freeze(
      services.map((service) => {
        const baselineP95Ms = baseline.latencyP95?.[service.id]?.baselineMs;
        if (
          typeof baselineP95Ms !== "number" ||
          !Number.isFinite(baselineP95Ms) ||
          baselineP95Ms <= 0
        ) {
          throw new Error("BASELINE_LATENCY_MISSING");
        }
        return Object.freeze({ ...service, baselineP95Ms });
      }),
    ),
  });
}

async function main() {
  try {
    const [baselinePath, outputPath, ...extra] = process.argv.slice(2);
    if (!baselinePath || !outputPath || extra.length > 0) throw new Error("ARGUMENT_INVALID");
    const profile = buildLoadProfile(JSON.parse(await readFile(resolve(baselinePath), "utf8")));
    const output = resolve(outputPath);
    const temporary = `${output}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(profile)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, output);
    process.stdout.write("LOAD_PROFILE_READY\n");
  } catch {
    process.stderr.write("PAUSE_ACCEPTANCE:LOAD_PROFILE_INVALID\n");
    process.exitCode = 78;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
