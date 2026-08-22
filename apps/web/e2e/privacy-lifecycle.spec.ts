import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  assertRuntimeOmits,
  assertRuntimeOmitsUpload,
  expectJobFilesRemoved,
  monitorRuntimeErrors,
  readStackState,
  registerUsernameUser,
  repositoryRoot,
  uniqueUsername,
} from "./helpers";

const privateFilename = "PRIVATE_FILENAME_SENTINEL.xlsx";
const privateBody = "PRIVATE_BODY_SENTINEL_8f9d2c";

function privateSpreadsheet(): Buffer {
  const fixture = Buffer.from(
    readFileSync(
      `${repositoryRoot}/apps/worker/tests/fixtures/spreadsheet.xlsx.base64`,
      "utf8",
    ).trim(),
    "base64",
  );
  const archive = unzipSync(fixture);
  archive["docProps/opentrad-privacy-sentinel.xml"] = strToU8(
    `<privacy-test>${privateBody}</privacy-test>`,
  );
  return Buffer.from(zipSync(archive));
}

test("cancelled upload leaves metadata only and omits private names and content", async ({
  page,
}, testInfo) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  const username = uniqueUsername("privacy", testInfo);
  await registerUsernameUser(page, username);
  const state = readStackState();

  await page.getByLabel("服务器转换类型").selectOption("spreadsheet.to.csv");
  const uploaded = privateSpreadsheet();
  await page.getByLabel("选择服务器处理文件").setInputFiles({
    buffer: uploaded,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    name: privateFilename,
  });
  await page.getByLabel("我同意本次文件上传到 OpenTrad 服务器处理").check();
  await page.getByRole("button", { name: "提交服务器处理" }).click();
  await expect(page.getByText(/排队中/u)).toBeVisible();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();

  await expectJobFilesRemoved(state.jobRoot);
  assertRuntimeOmits(state, [privateFilename, privateBody]);
  assertRuntimeOmitsUpload(state, uploaded);
  expect(runtimeErrors).toEqual([]);
});
