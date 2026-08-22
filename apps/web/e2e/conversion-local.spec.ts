import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, monitorRuntimeErrors, repositoryRoot } from "./helpers";

const sourcePdfs = [
  "tests/golds/templates-v2/artifacts/quotation.service.project.v1/default.pdf",
  "tests/golds/templates-v2/artifacts/contract.sale.domestic-b2b.v1/default.pdf",
].map((path) => `${repositoryRoot}/${path}`);

test("organizes real PDFs locally without sending their contents to an API", async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await page.goto("/convert");
  await expect(page.getByRole("heading", { level: 2, name: "本地处理" })).toBeVisible();
  await page.getByLabel("本地转换类型").selectOption("pdf.organize");
  await page.getByLabel("选择本地转换文件").setInputFiles(sourcePdfs);

  const requests: Array<{ method: string; pathname: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), pathname: url.pathname });
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "本地转换", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("opentrad-local-pdf-organize.pdf");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect((await import("node:fs")).statSync(path as string).size).toBeGreaterThan(100);
  await expect(page.getByText("转换完成，文件未离开浏览器")).toBeVisible();

  expect(requests.filter((request) => request.pathname.startsWith("/api/"))).toEqual([]);
  expect(requests.filter((request) => !["GET", "HEAD"].includes(request.method))).toEqual([]);
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("converts private text semantically without API traffic", async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await page.goto("/convert");
  await page.getByLabel("本地转换类型").selectOption("text.semantic");
  await page.getByLabel("输出格式").selectOption("html");
  await page.getByLabel("选择本地转换文件").setInputFiles({
    buffer: Buffer.from("采购清单：轴承 20 套", "utf8"),
    mimeType: "text/plain",
    name: "private-local.txt",
  });

  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${pathname}`);
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "本地转换", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("opentrad-local-text-semantic.html");
  const resultPath = await download.path();
  expect(resultPath).not.toBeNull();
  expect(readFileSync(resultPath as string, "utf8")).toBe("<pre>采购清单:轴承 20 套</pre>");
  await expect(page.getByText("转换完成，文件未离开浏览器")).toBeVisible();
  expect(apiRequests).toEqual([]);
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});
