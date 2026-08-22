import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeTrivyReport } from "../../scripts/release/normalize-trivy-report.mjs";
import { verifyTrivyPolicy } from "../../scripts/release/verify-trivy-policy.mjs";

const root = new URL("../../", import.meta.url);

const finding = Object.freeze({
  images: ["api", "worker"],
  installedVersion: "1:1.2.13.dfsg-1",
  package: "zlib1g",
  severity: "CRITICAL",
  status: "will_not_fix",
  vulnerabilityId: "CVE-2023-45853",
});

const policy = Object.freeze({
  approval: {
    approvedAt: "2026-08-22T15:30:00.000Z",
    approvedBy: "release-owner",
    expiresAt: "2026-09-05T15:30:00.000Z",
    rationale: "No vendor-fixed package exists; release remains isolated and read-only.",
    status: "approved",
  },
  findings: [finding],
  schemaVersion: 1,
});

function report(image, overrides = {}) {
  const vulnerability = {
    FixedVersion: "",
    InstalledVersion: finding.installedVersion,
    PkgName: finding.package,
    Severity: finding.severity,
    Status: finding.status,
    VulnerabilityID: finding.vulnerabilityId,
    ...overrides,
  };
  return {
    ArtifactName:
      image === "clamav"
        ? `clamav/clamav@sha256:${"a".repeat(64)}`
        : `ghcr.io/open-trad/opentrad-${image}@sha256:${"a".repeat(64)}`,
    ArtifactType: "container_image",
    Results: [{ Target: "debian 12.15", Vulnerabilities: [vulnerability] }],
    SchemaVersion: 2,
  };
}

const cleanClamav = Object.freeze({
  ArtifactName: `clamav/clamav@sha256:${"b".repeat(64)}`,
  ArtifactType: "container_image",
  Results: [{ Class: "os-pkgs", Packages: [{}], Target: "debian 13", Type: "alpine" }],
  SchemaVersion: 2,
});

const normalizedCleanClamav = Object.freeze(normalizeTrivyReport(cleanClamav));

const now = new Date("2026-08-22T16:00:00.000Z");

test("Trivy normalizer makes native clean results explicit and rejects incomplete scans", () => {
  assert.deepEqual(normalizedCleanClamav.Results[0].Vulnerabilities, []);
  for (const input of [
    { ...cleanClamav, Results: [] },
    { ...cleanClamav, Results: [{}] },
    { ...cleanClamav, Results: [{ ...cleanClamav.Results[0], Packages: [] }] },
    {
      ...cleanClamav,
      Results: [{ ...cleanClamav.Results[0], Vulnerabilities: null }],
    },
  ]) {
    assert.throws(() => normalizeTrivyReport(input), {
      code: "PAUSE_RELEASE:TRIVY_REPORT_INVALID",
    });
  }
});

test("Trivy policy accepts only the exact approved residual set", () => {
  assert.deepEqual(
    verifyTrivyPolicy({
      now,
      policy,
      reports: { api: report("api"), clamav: normalizedCleanClamav, worker: report("worker") },
    }),
    { acceptedFindings: 2, policyExpiresAt: policy.approval.expiresAt },
  );
});

test("Trivy policy rejects unapproved, expired, or overlong approvals", () => {
  assert.throws(
    () =>
      verifyTrivyPolicy({
        now,
        policy: { ...policy, approval: { ...policy.approval, status: "proposed" } },
        reports: {
          api: report("api"),
          clamav: normalizedCleanClamav,
          worker: report("worker"),
        },
      }),
    { code: "PAUSE_RELEASE:TRIVY_POLICY_UNAPPROVED" },
  );
  assert.throws(
    () =>
      verifyTrivyPolicy({
        now: new Date(policy.approval.expiresAt),
        policy,
        reports: {
          api: report("api"),
          clamav: normalizedCleanClamav,
          worker: report("worker"),
        },
      }),
    { code: "PAUSE_RELEASE:TRIVY_POLICY_EXPIRED" },
  );
  assert.throws(
    () =>
      verifyTrivyPolicy({
        now,
        policy: {
          ...policy,
          approval: { ...policy.approval, expiresAt: "2026-09-06T15:30:00.001Z" },
        },
        reports: {
          api: report("api"),
          clamav: normalizedCleanClamav,
          worker: report("worker"),
        },
      }),
    { code: "PAUSE_RELEASE:TRIVY_POLICY_WINDOW_INVALID" },
  );
});

test("Trivy policy rejects fixed, unlisted, changed, or missing findings", () => {
  const cases = [
    {
      code: "PAUSE_RELEASE:TRIVY_FIXED_VERSION_AVAILABLE",
      reports: {
        api: report("api", { FixedVersion: "1:1.2.13.dfsg-2" }),
        clamav: normalizedCleanClamav,
        worker: report("worker"),
      },
    },
    {
      code: "PAUSE_RELEASE:TRIVY_FINDING_UNREVIEWED",
      reports: {
        api: report("api", { VulnerabilityID: "CVE-2099-0001" }),
        clamav: normalizedCleanClamav,
        worker: report("worker"),
      },
    },
    {
      code: "PAUSE_RELEASE:TRIVY_FINDING_UNREVIEWED",
      reports: {
        api: report("api", { Status: "fix_deferred" }),
        clamav: normalizedCleanClamav,
        worker: report("worker"),
      },
    },
    {
      code: "PAUSE_RELEASE:TRIVY_POLICY_STALE",
      reports: {
        api: {
          ...report("api"),
          Results: [{ Target: "debian 12.15", Vulnerabilities: [] }],
        },
        clamav: normalizedCleanClamav,
        worker: report("worker"),
      },
    },
    {
      code: "PAUSE_RELEASE:TRIVY_CLAMAV_FINDING",
      reports: { api: report("api"), clamav: report("clamav"), worker: report("worker") },
    },
  ];
  for (const fixture of cases) {
    assert.throws(() => verifyTrivyPolicy({ now, policy, reports: fixture.reports }), {
      code: fixture.code,
    });
  }
});

test("Trivy policy rejects malformed reports and duplicate policy entries", () => {
  const malformed = [
    { ...report("api"), Results: [] },
    {
      ...report("api"),
      Results: [{ Class: "os-pkgs", Packages: [{}], Target: "x", Type: "debian" }],
    },
    report("api", { Severity: undefined }),
    report("api", { Severity: "UNKNOWN" }),
    report("api", { FixedVersion: 7 }),
  ];
  for (const api of malformed) {
    assert.throws(
      () =>
        verifyTrivyPolicy({
          now,
          policy,
          reports: { api, clamav: normalizedCleanClamav, worker: report("worker") },
        }),
      { code: "PAUSE_RELEASE:TRIVY_REPORT_INVALID" },
    );
  }
  assert.throws(
    () =>
      verifyTrivyPolicy({
        now,
        policy: { ...policy, findings: [finding, finding] },
        reports: {
          api: report("api"),
          clamav: normalizedCleanClamav,
          worker: report("worker"),
        },
      }),
    { code: "PAUSE_RELEASE:TRIVY_POLICY_DUPLICATE" },
  );
});

test("versioned draft exactly represents the retained release evidence", async () => {
  const draft = JSON.parse(
    await readFile(new URL("infra/docker/trivy-exceptions.json", root), "utf8"),
  );
  assert.equal(draft.approval.status, "proposed");
  assert.equal(draft.findings.length, 35);
  const reports = {
    api: { ...report("api"), Results: [{ Target: "debian 12.15", Vulnerabilities: [] }] },
    clamav: normalizedCleanClamav,
    worker: {
      ...report("worker"),
      Results: [{ Target: "debian 12.15", Vulnerabilities: [] }],
    },
  };
  for (const entry of draft.findings) {
    for (const image of entry.images) {
      reports[image].Results[0].Vulnerabilities.push({
        FixedVersion: "",
        InstalledVersion: entry.installedVersion,
        PkgName: entry.package,
        Severity: entry.severity,
        Status: entry.status,
        VulnerabilityID: entry.vulnerabilityId,
      });
    }
  }
  const approved = {
    ...draft,
    approval: {
      ...draft.approval,
      approvedAt: policy.approval.approvedAt,
      approvedBy: policy.approval.approvedBy,
      expiresAt: policy.approval.expiresAt,
      status: "approved",
    },
  };
  assert.deepEqual(verifyTrivyPolicy({ now, policy: approved, reports }), {
    acceptedFindings: 65,
    policyExpiresAt: policy.approval.expiresAt,
  });
});
