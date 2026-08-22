#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVAL_WINDOW_MS = 14 * DAY_MS;
const IMAGE_NAMES = Object.freeze(["api", "worker"]);
const SEVERITIES = Object.freeze(["CRITICAL", "HIGH"]);
const VENDOR_STATUSES = Object.freeze(["affected", "fix_deferred", "will_not_fix"]);

function policyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function exactKeys(input, expected) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const actual = Object.keys(input).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function exactInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return milliseconds;
}

function tupleKey(image, finding) {
  return JSON.stringify([
    image,
    finding.vulnerabilityId,
    finding.severity,
    finding.package,
    finding.installedVersion,
    finding.status,
  ]);
}

function parsePolicy(policy, now) {
  if (!exactKeys(policy, ["approval", "findings", "schemaVersion"])) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_INVALID");
  }
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.findings)) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_INVALID");
  }
  const approval = policy.approval;
  if (!exactKeys(approval, ["approvedAt", "approvedBy", "expiresAt", "rationale", "status"])) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_INVALID");
  }
  if (approval.status !== "approved") {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_UNAPPROVED");
  }
  const approvedAt = exactInstant(approval.approvedAt);
  const expiresAt = exactInstant(approval.expiresAt);
  if (
    approvedAt === null ||
    expiresAt === null ||
    typeof approval.approvedBy !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(approval.approvedBy) ||
    typeof approval.rationale !== "string" ||
    approval.rationale.length < 20 ||
    approval.rationale.length > 500 ||
    !(now instanceof Date) ||
    Number.isNaN(now.getTime())
  ) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_INVALID");
  }
  if (
    approvedAt > now.getTime() ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAX_APPROVAL_WINDOW_MS
  ) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_WINDOW_INVALID");
  }
  if (now.getTime() >= expiresAt) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_EXPIRED");
  }

  const allowed = new Set();
  for (const finding of policy.findings) {
    if (
      !exactKeys(finding, [
        "images",
        "installedVersion",
        "package",
        "severity",
        "status",
        "vulnerabilityId",
      ]) ||
      !Array.isArray(finding.images) ||
      finding.images.length === 0 ||
      finding.images.some((image) => !IMAGE_NAMES.includes(image)) ||
      new Set(finding.images).size !== finding.images.length ||
      [...finding.images].sort().some((image, index) => image !== finding.images[index]) ||
      typeof finding.vulnerabilityId !== "string" ||
      !/^CVE-\d{4}-\d{4,}$/.test(finding.vulnerabilityId) ||
      !SEVERITIES.includes(finding.severity) ||
      typeof finding.package !== "string" ||
      finding.package.length === 0 ||
      typeof finding.installedVersion !== "string" ||
      finding.installedVersion.length === 0 ||
      !VENDOR_STATUSES.includes(finding.status)
    ) {
      throw policyError("PAUSE_RELEASE:TRIVY_POLICY_INVALID");
    }
    for (const image of finding.images) {
      const key = tupleKey(image, finding);
      if (allowed.has(key)) throw policyError("PAUSE_RELEASE:TRIVY_POLICY_DUPLICATE");
      allowed.add(key);
    }
  }
  return { allowed, expiresAt: approval.expiresAt };
}

function expectedArtifact(image) {
  if (image === "api") {
    return /^ghcr\.io\/open-trad\/opentrad-api@sha256:[a-f0-9]{64}$/;
  }
  if (image === "worker") {
    return /^ghcr\.io\/open-trad\/opentrad-worker@sha256:[a-f0-9]{64}$/;
  }
  return /^(?:docker\.io\/)?clamav\/clamav(?::[^@]+)?@sha256:[a-f0-9]{64}$/;
}

function parseReport(image, report) {
  if (
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.SchemaVersion !== 2 ||
    report.ArtifactType !== "container_image" ||
    typeof report.ArtifactName !== "string" ||
    !expectedArtifact(image).test(report.ArtifactName) ||
    !Array.isArray(report.Results)
  ) {
    throw policyError("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
  }
  const findings = [];
  for (const result of report.Results) {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw policyError("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
    }
    if (result.Vulnerabilities === null || result.Vulnerabilities === undefined) continue;
    if (!Array.isArray(result.Vulnerabilities)) {
      throw policyError("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
    }
    for (const vulnerability of result.Vulnerabilities) {
      if (
        vulnerability === null ||
        typeof vulnerability !== "object" ||
        Array.isArray(vulnerability)
      ) {
        throw policyError("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
      }
      if (!SEVERITIES.includes(vulnerability.Severity)) continue;
      if (image === "clamav") throw policyError("PAUSE_RELEASE:TRIVY_CLAMAV_FINDING");
      if (
        typeof vulnerability.FixedVersion === "string" &&
        vulnerability.FixedVersion.trim() !== ""
      ) {
        throw policyError("PAUSE_RELEASE:TRIVY_FIXED_VERSION_AVAILABLE");
      }
      if (
        typeof vulnerability.VulnerabilityID !== "string" ||
        typeof vulnerability.PkgName !== "string" ||
        typeof vulnerability.InstalledVersion !== "string" ||
        typeof vulnerability.Status !== "string"
      ) {
        throw policyError("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
      }
      findings.push({
        image,
        installedVersion: vulnerability.InstalledVersion,
        package: vulnerability.PkgName,
        severity: vulnerability.Severity,
        status: vulnerability.Status,
        vulnerabilityId: vulnerability.VulnerabilityID,
      });
    }
  }
  return findings;
}

export function verifyTrivyPolicy({ now = new Date(), policy, reports }) {
  if (!exactKeys(reports, ["api", "clamav", "worker"])) {
    throw policyError("PAUSE_RELEASE:TRIVY_REPORT_INVALID");
  }
  const { allowed, expiresAt } = parsePolicy(policy, now);
  const observed = new Set();
  let acceptedFindings = 0;
  for (const image of ["api", "worker", "clamav"]) {
    for (const finding of parseReport(image, reports[image])) {
      const key = tupleKey(image, finding);
      if (!allowed.has(key)) throw policyError("PAUSE_RELEASE:TRIVY_FINDING_UNREVIEWED");
      if (observed.has(key)) throw policyError("PAUSE_RELEASE:TRIVY_REPORT_DUPLICATE");
      observed.add(key);
      acceptedFindings += 1;
    }
  }
  if (observed.size !== allowed.size || [...allowed].some((key) => !observed.has(key))) {
    throw policyError("PAUSE_RELEASE:TRIVY_POLICY_STALE");
  }
  return Object.freeze({ acceptedFindings, policyExpiresAt: expiresAt });
}

function parseArguments(argv) {
  const options = {};
  const mapping = {
    "--api": "api",
    "--clamav": "clamav",
    "--policy": "policy",
    "--worker": "worker",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = mapping[argv[index]];
    const value = argv[index + 1];
    if (!key || !value || options[key]) throw policyError("PAUSE_RELEASE:TRIVY_ARGUMENT_INVALID");
    options[key] = value;
    index += 1;
  }
  if (!exactKeys(options, ["api", "clamav", "policy", "worker"])) {
    throw policyError("PAUSE_RELEASE:TRIVY_ARGUMENT_INVALID");
  }
  return options;
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw policyError(code);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [policy, api, worker, clamav] = await Promise.all([
    readJson(options.policy, "PAUSE_RELEASE:TRIVY_POLICY_INVALID"),
    readJson(options.api, "PAUSE_RELEASE:TRIVY_REPORT_INVALID"),
    readJson(options.worker, "PAUSE_RELEASE:TRIVY_REPORT_INVALID"),
    readJson(options.clamav, "PAUSE_RELEASE:TRIVY_REPORT_INVALID"),
  ]);
  const result = verifyTrivyPolicy({ policy, reports: { api, clamav, worker } });
  process.stdout.write(
    `TRIVY_POLICY_ACCEPTED findings=${result.acceptedFindings} expires=${result.policyExpiresAt}\n`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.code ?? "PAUSE_RELEASE:TRIVY_POLICY_INTERNAL"}\n`);
    process.exitCode = 1;
  });
}
