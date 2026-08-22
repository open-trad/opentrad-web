import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  assertRuntimeOmitsUpload,
  expectJobFilesRemoved,
  expectNoHorizontalOverflow,
  monitorRuntimeErrors,
  readStackState,
  registerUsernameUser,
  repositoryRoot,
  uniqueUsername,
} from "./helpers";

const spreadsheet = Buffer.from(
  readFileSync(
    `${repositoryRoot}/apps/worker/tests/fixtures/spreadsheet.xlsx.base64`,
    "utf8",
  ).trim(),
  "base64",
);
const officeDocument = `${repositoryRoot}/tests/golds/templates-v2/artifacts/contract.sale.domestic-b2b.v1/default.docx`;

test("real account can complete, download, and cancel server jobs", async ({ page }, testInfo) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  const username = uniqueUsername("jobs", testInfo);
  await registerUsernameUser(page, username);

  await page.getByLabel("服务器转换类型").selectOption("spreadsheet.to.csv");
  await page.getByLabel("选择服务器处理文件").setInputFiles({
    buffer: spreadsheet,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    name: "server-flow.xlsx",
  });
  await page.getByLabel("我同意本次文件上传到 OpenTrad 服务器处理").check();
  await page.getByRole("button", { name: "提交服务器处理" }).click();
  await expect(page.getByText(/排队中/u)).toBeVisible();

  const workerResult = await page.evaluate(async () => {
    const response = await fetch("/__e2e__/worker/run-once", { method: "POST" });
    return { body: await response.json(), status: response.status };
  });
  expect(workerResult).toEqual({ body: { outcome: "succeeded" }, status: 200 });
  await expect(page.getByText(/处理完成/u)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载处理结果" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("opentrad-server-spreadsheet-to-csv.csv");
  const resultPath = await download.path();
  expect(resultPath).not.toBeNull();
  const bytes = readFileSync(resultPath as string);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(new TextDecoder().decode(bytes.subarray(3))).toBe("首页\r\n3\r\n");
  await expectJobFilesRemoved(readStackState().jobRoot);
  assertRuntimeOmitsUpload(readStackState(), spreadsheet);

  await page.getByLabel("服务器转换类型").selectOption("office.to.pdf");
  await page.getByLabel("选择服务器处理文件").setInputFiles(officeDocument);
  await page.getByLabel("我同意本次文件上传到 OpenTrad 服务器处理").check();
  await page.getByRole("button", { name: "提交服务器处理" }).click();
  await expect(page.getByText(/排队中/u)).toBeVisible();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expectJobFilesRemoved(readStackState().jobRoot);
  await page.getByRole("button", { name: "开始新任务" }).click();
  await expect(page.getByText("选择文件并确认后，才会上传本次任务")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});
