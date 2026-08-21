import { hardenWorkerValue } from "./manifest.js";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

export const WORKER_ISOLATION_POLICY = hardenWorkerValue({
  capDrop: ["ALL" as const],
  cpu: 1.25,
  dockerSocket: false,
  gid: 10002,
  hostJobPath: false,
  memoryBytes: 3 * GIBIBYTE,
  mounts: {
    jobs: {
      flags: ["nodev" as const, "nosuid" as const, "noexec" as const],
      gid: 10100,
      mode: 0o770,
      path: "/jobs",
      sizeBytes: 2 * GIBIBYTE,
      type: "tmpfs" as const,
      uid: 10001,
    },
    run: {
      flags: ["nodev" as const, "nosuid" as const, "noexec" as const],
      gid: 10002,
      mode: 0o700,
      path: "/run/opentrad",
      sizeBytes: 64 * MEBIBYTE,
      type: "tmpfs" as const,
      uid: 10002,
    },
    work: {
      flags: ["nodev" as const, "nosuid" as const, "noexec" as const],
      gid: 10002,
      mode: 0o700,
      path: "/work",
      sizeBytes: 2 * GIBIBYTE,
      type: "tmpfs" as const,
      uid: 10002,
    },
  },
  network: "none" as const,
  noNewPrivileges: true,
  pids: 256,
  readOnlyRoot: true,
  supplementaryGroups: [10100],
  uid: 10002,
});
