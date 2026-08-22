import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  monitorPrivateLocalNetwork,
  monitorRuntimeErrors,
  repositoryRoot,
} from "./helpers";

const sourcePdfs = [
  "tests/golds/templates-v2/artifacts/quotation.service.project.v1/default.pdf",
  "tests/golds/templates-v2/artifacts/contract.sale.domestic-b2b.v1/default.pdf",
].map((path) => `${repositoryRoot}/${path}`);

test("organizes real PDFs locally without sending their contents to an API", async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  const privateSentinels = ["quotation.service.project.v1", "contract.sale.domestic-b2b.v1"];
  const networkViolations = monitorPrivateLocalNetwork(page, privateSentinels);
  await page.goto("/convert");
  await expect(page.getByRole("heading", { level: 2, name: "本地处理" })).toBeVisible();
  await page.getByLabel("本地转换类型").selectOption("pdf.organize");
  await page.getByLabel("选择本地转换文件").setInputFiles(sourcePdfs);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "本地转换", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("opentrad-local-pdf-organize.pdf");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect((await import("node:fs")).statSync(path as string).size).toBeGreaterThan(100);
  await expect(page.getByText("转换完成，文件未离开浏览器")).toBeVisible();

  expect(networkViolations).toEqual([]);
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("converts private text semantically without API traffic", async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  const privateText = "采购清单：轴承 20 套";
  const privateName = "private-local.txt";
  const networkViolations = monitorPrivateLocalNetwork(page, [privateText, privateName]);
  await page.goto("/convert");
  await page.getByLabel("本地转换类型").selectOption("text.semantic");
  await page.getByLabel("输出格式").selectOption("html");
  await page.getByLabel("选择本地转换文件").setInputFiles({
    buffer: Buffer.from(privateText, "utf8"),
    mimeType: "text/plain",
    name: privateName,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "本地转换", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("opentrad-local-text-semantic.html");
  const resultPath = await download.path();
  expect(resultPath).not.toBeNull();
  expect(readFileSync(resultPath as string, "utf8")).toBe("<pre>采购清单:轴承 20 套</pre>");
  await expect(page.getByText("转换完成，文件未离开浏览器")).toBeVisible();
  expect(networkViolations).toEqual([]);
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("cancels an active disposable PDF worker without a late download", async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  const networkViolations = monitorPrivateLocalNetwork(page, ["cancel-private.pdf"]);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.goto("/convert");
  await page.getByLabel("本地转换类型").selectOption("pdf.organize");
  await page.getByLabel("选择本地转换文件").setInputFiles(
    Array.from({ length: 20 }, (_, index) => ({
      buffer: readFileSync(sourcePdfs[index % sourcePdfs.length] as string),
      mimeType: "application/pdf",
      name: `cancel-private-${index}.pdf`,
    })),
  );

  await page.getByRole("button", { name: "本地转换", exact: true }).click();
  await page.getByRole("button", { name: "取消本地转换" }).click();
  await expect(page.getByText("本地转换已取消")).toBeVisible();
  await page.waitForTimeout(500);

  expect(downloads).toEqual([]);
  expect(networkViolations).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
