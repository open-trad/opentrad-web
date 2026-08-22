#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export const existingServiceTargets = Object.freeze([
  Object.freeze({ id: "openvac-web", url: "https://openvac.cn/" }),
  Object.freeze({ id: "paperbanana-auth", url: "https://api.paperbanana.asia/" }),
  Object.freeze({ id: "tensor-auto-web", url: "https://tensor-auto.dns.army/" }),
  Object.freeze({ id: "tensor-auto-api", url: "https://tensor-auto.dns.army/" }),
]);

export function summarizeLatency(samples) {
  if (
    !Array.isArray(samples) ||
    samples.length !== 5 ||
    samples.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error("LATENCY_SAMPLES_INVALID");
  }
  const windowsMs = samples.map((value) => Math.round(value * 1000) / 1000);
  const ordered = [...windowsMs].sort((left, right) => left - right);
  return Object.freeze({ baselineMs: ordered[4], windowsMs: Object.freeze(windowsMs) });
}

export async function captureLatency({ fetchImpl = fetch, targets = existingServiceTargets } = {}) {
  const result = {};
  for (const target of targets) {
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const started = performance.now();
      try {
        const response = await fetchImpl(target.url, {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
        });
        if (response.status >= 500) throw new Error("LATENCY_TARGET_UNHEALTHY");
        samples.push(performance.now() - started);
      } finally {
        clearTimeout(timeout);
      }
    }
    result[target.id] = summarizeLatency(samples);
  }
  return Object.freeze(result);
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await captureLatency())}\n`);
  } catch {
    process.stderr.write("PAUSE_BASELINE:LATENCY_PROBE_FAILED\n");
    process.exitCode = 78;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
