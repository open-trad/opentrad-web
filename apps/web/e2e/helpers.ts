import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, type TestInfo } from "@playwright/test";

export const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export interface E2eStackState {
  readonly databasePath: string;
  readonly jobRoot: string;
  readonly logPath: string;
  readonly runtimeRoot: string;
}

export function readStackState(): E2eStackState {
  const runId = process.env.OPENTRAD_E2E_RUN_ID;
  if (!runId) throw new Error("E2E_RUN_ID_UNAVAILABLE");
  return JSON.parse(
    readFileSync(join(tmpdir(), `opentrad-e2e-stack-state-${runId}.json`), "utf8"),
  ) as E2eStackState;
}

export function listFilesRecursively(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

export async function expectJobFilesRemoved(jobRoot: string): Promise<void> {
  await expect
    .poll(() => listFilesRecursively(jobRoot), {
      message: "private job files should be removed",
      timeout: 15_000,
    })
    .toEqual([]);
}

export function assertRuntimeOmits(state: E2eStackState, forbidden: readonly string[]): void {
  for (const filePath of [
    state.databasePath,
    `${state.databasePath}-wal`,
    `${state.databasePath}-shm`,
    state.logPath,
  ]) {
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath).toString("utf8");
    for (const value of forbidden) expect(text).not.toContain(value);
  }
}

export function assertRuntimeOmitsUpload(state: E2eStackState, uploaded: Buffer): void {
  const digests = [
    createHash("sha256").update(uploaded).digest("hex"),
    createHash("sha256").update(uploaded).digest("base64"),
  ];
  for (const filePath of [
    state.databasePath,
    `${state.databasePath}-wal`,
    `${state.databasePath}-shm`,
    state.logPath,
  ]) {
    if (!existsSync(filePath)) continue;
    const bytes = readFileSync(filePath);
    expect(bytes.indexOf(uploaded), `${filePath} retained the exact upload`).toBe(-1);
    const text = bytes.toString("utf8");
    for (const digest of digests) expect(text).not.toContain(digest);
  }
}

export function monitorPrivateLocalNetwork(page: Page, sentinels: readonly string[]): string[] {
  const violations: string[] = [];
  const staticRoot = join(repositoryRoot, "apps/web/dist");
  const exactAssets = new Set(
    listFilesRecursively(staticRoot)
      .map((path) => `/${relative(staticRoot, path).split(sep).join("/")}`)
      .filter((path) => path !== "/index.html"),
  );
  const encodedSentinels = sentinels.map((sentinel) => {
    const bytes = Buffer.from(sentinel, "utf8");
    const percent = encodeURIComponent(sentinel);
    return new Set([
      sentinel,
      encodeURI(sentinel),
      percent,
      percent.toLowerCase(),
      bytes.toString("base64"),
      bytes.toString("base64url"),
      bytes.toString("hex"),
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(bytes).digest("base64"),
      createHash("sha256").update(bytes).digest("base64url"),
    ]);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    const body = request.postDataBuffer();
    const searchable = [
      request.url(),
      ...Object.entries(headers).flat(),
      body?.toString("utf8") ?? "",
    ].join("\n");
    for (const variants of encodedSentinels) {
      if ([...variants].some((variant) => searchable.includes(variant))) {
        violations.push(`private sentinel in ${url.pathname}`);
      }
    }
    const immutableAsset = exactAssets.has(url.pathname);
    const publicBootstrapApi =
      url.pathname === "/api/auth/get-session" || url.pathname === "/api/v1/auth-options";
    const allowed =
      url.origin === "https://opentrad.dynv6.net:4173" &&
      url.search === "" &&
      (request.method() === "GET" || request.method() === "HEAD") &&
      (url.pathname === "/convert" || immutableAsset || publicBootstrapApi);
    if (!allowed) violations.push(`${request.method()} ${request.url()}`);
  });
  return violations;
}

export function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

export async function registerUsernameUser(
  page: Page,
  username: string,
  password = "OpenTrad-e2e-password-2026",
): Promise<void> {
  await page.goto("/convert");
  await page.getByRole("tab", { name: "注册" }).click();
  await page.getByLabel("注册用户名").fill(username);
  await page.getByLabel("注册密码").fill(password);
  await page.getByLabel("我已知晓该账户不提供密码找回").check();
  await page.getByRole("button", { name: "创建账户" }).click();
  await expect(page.getByText("当前账户")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: username })).toBeVisible();
}

export function uniqueUsername(prefix: string, testInfo: TestInfo): string {
  const project = testInfo.project.name.includes("mobile") ? "m" : "d";
  const entropy = randomUUID().replaceAll("-", "").slice(0, 8);
  return `${prefix}_${project}_w${testInfo.workerIndex}r${testInfo.retry}_${entropy}`;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

export function fileSize(path: string): number {
  return statSync(path).size;
}
