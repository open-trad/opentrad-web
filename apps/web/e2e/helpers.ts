import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export interface E2eStackState {
  readonly databasePath: string;
  readonly jobRoot: string;
  readonly logPath: string;
  readonly runtimeRoot: string;
}

export function readStackState(): E2eStackState {
  return JSON.parse(
    readFileSync(join(tmpdir(), "opentrad-e2e-stack-state.json"), "utf8"),
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
  for (const path of [state.databasePath, state.logPath]) {
    const text = readFileSync(path).toString("utf8");
    for (const value of forbidden) expect(text).not.toContain(value);
  }
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
