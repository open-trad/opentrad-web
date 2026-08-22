import { describe, expect, it } from "vitest";
import { WORKER_ISOLATION_POLICY } from "../src/isolation.js";

function expectHardened(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  if (Array.isArray(value)) {
    for (const entry of value) expectHardened(entry);
    return;
  }
  expect(Object.getPrototypeOf(value)).toBeNull();
  for (const entry of Object.values(value)) expectHardened(entry);
}

describe("production worker isolation contract", () => {
  it("is an exact frozen serializable networkless non-root container policy", () => {
    expect(WORKER_ISOLATION_POLICY).toEqual({
      capDrop: ["ALL"],
      cpu: 1.25,
      dockerSocket: false,
      gid: 10002,
      hostJobPath: false,
      memoryBytes: 3 * 1024 * 1024 * 1024,
      mounts: {
        jobs: {
          flags: ["nodev", "nosuid", "noexec"],
          gid: 10100,
          mode: 0o770,
          path: "/jobs",
          sizeBytes: 2 * 1024 * 1024 * 1024,
          type: "tmpfs",
          uid: 10001,
        },
        run: {
          flags: ["nodev", "nosuid", "noexec"],
          gid: 10002,
          mode: 0o700,
          path: "/run/opentrad",
          sizeBytes: 64 * 1024 * 1024,
          type: "tmpfs",
          uid: 10002,
        },
        work: {
          flags: ["nodev", "nosuid", "noexec"],
          gid: 10002,
          mode: 0o700,
          path: "/work",
          sizeBytes: 2 * 1024 * 1024 * 1024,
          type: "tmpfs",
          uid: 10002,
        },
      },
      network: "none",
      noNewPrivileges: true,
      pids: 256,
      readOnlyRoot: true,
      supplementaryGroups: [10100],
      uid: 10002,
    });
    expect(JSON.parse(JSON.stringify(WORKER_ISOLATION_POLICY))).toEqual(WORKER_ISOLATION_POLICY);
    expectHardened(WORKER_ISOLATION_POLICY);
  });
});
