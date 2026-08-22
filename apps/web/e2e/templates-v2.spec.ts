import { type Download, expect, type Page, test } from "@playwright/test";

const runtimeErrors = new WeakMap<Page, string[]>();
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? []).toEqual([]);
});

async function openEditor(page: Page, templateId: string, heading: string) {
  await page.goto(`/editor/${templateId}`);
  await expect(page).toHaveURL(new RegExp(`/editor/${templateId}$`, "u"));
  await expect(
    page.locator(".document-editor-v2__topbar").getByRole("heading", { level: 1 }),
  ).toHaveText(heading);
  await expect(page.getByText("所有文书内容仅保存在当前设备").first()).toBeVisible();
}

async function downloadFrom(page: Page, buttonName: string | RegExp): Promise<Download> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  await download.path();
  return download;
}

test("service quote survives refresh and exports/imports every local format", async ({ page }) => {
  await openEditor(page, "quotation.service.project.v1", "项目服务报价单");
  const projectName = page.getByLabel("项目名称");
  await projectName.fill("工厂节能改造咨询");
  await expect(page.getByText("已保存到本机")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("项目名称")).toHaveValue("工厂节能改造咨询");

  await page.getByLabel("文书版式").selectOption("classic-formal.v1");
  await expect(page.locator("article.document-html")).toHaveAttribute(
    "data-layout-style",
    "classic-formal.v1",
  );

  const word = await downloadFrom(page, "下载 Word");
  expect(word.suggestedFilename()).toMatch(/^项目服务报价单-.*\.docx$/u);
  const pdf = await downloadFrom(page, "下载 PDF");
  expect(pdf.suggestedFilename()).toMatch(/^项目服务报价单-.*\.pdf$/u);
  const json = await downloadFrom(page, "下载 JSON");
  expect(json.suggestedFilename()).toMatch(/^项目服务报价单-.*\.json$/u);
  const project = await downloadFrom(page, "导出本地项目 ZIP");
  expect(project.suggestedFilename()).toMatch(/^项目服务报价单-.*\.opentrad$/u);
  const projectPath = await project.path();
  expect(projectPath).not.toBeNull();

  await page.getByLabel("项目名称").fill("等待项目包恢复的临时名称");
  await page.getByRole("button", { name: "立即保存" }).click();
  await expect(page.getByText("已保存到本机")).toBeVisible();
  await page.getByLabel("导入本地项目 ZIP").setInputFiles(projectPath as string);
  const dialog = page.getByRole("dialog", { name: "确认导入本地项目" });
  await expect(dialog).toContainText("0 个附件");
  await dialog.getByRole("button", { name: "确认并导入" }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("工厂节能改造咨询");
});

test("bilingual quotation renders both languages from one local model", async ({ page }) => {
  await openEditor(page, "quotation.export.bilingual.v1", "中英双语出口报价单");
  const preview = page.locator("article.document-html");
  await expect(preview).toHaveAttribute("data-language-view", "zh-en");
  await expect(preview).toContainText("双语出口报价单");
  await expect(preview).toContainText("Bilingual Export Quotation");
});

test("unbound bid exports only a marked internal draft and round-trips attachments", async ({
  page,
}) => {
  await openEditor(page, "bid.government.goods.v1", "政府采购货物投标文件");
  await expect(page.getByText(/内部投标底稿/u).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "下载提交版 PDF" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载内部底稿 PDF" })).toBeEnabled();

  await page.getByLabel("项目招标文件").setInputFiles({
    name: "项目招标文件.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  const attachmentConfirmation = page.getByRole("region", { name: "确认附件信息" });
  await attachmentConfirmation.getByRole("button", { name: "附加到本机文书" }).click();
  const inventory = page.getByRole("region", { name: "本机附件" });
  await expect(inventory).toContainText("项目招标文件.png");
  await expect(page.getByRole("button", { name: "导出本地项目 ZIP" })).toBeEnabled();

  const project = await downloadFrom(page, "导出本地项目 ZIP");
  const projectPath = await project.path();
  expect(projectPath).not.toBeNull();
  await inventory.getByRole("button", { name: "删除附件" }).click();
  await expect(page.getByRole("region", { name: "本机附件" })).toHaveCount(0);

  await page.getByLabel("导入本地项目 ZIP").setInputFiles(projectPath as string);
  const dialog = page.getByRole("dialog", { name: "确认导入本地项目" });
  await expect(dialog).toContainText("1 个附件");
  await dialog.getByRole("button", { name: "确认并导入" }).click();
  await expect(page.getByRole("region", { name: "本机附件" })).toContainText("项目招标文件.png");
});

test("clear-all requires confirmation and leaves a fresh local V1 draft", async ({ page }) => {
  await page.goto("/editor/standard-goods-quote");
  await expect(page.getByRole("heading", { level: 1, name: "标准商品报价单" })).toBeVisible();
  const sellerName = page.getByRole("textbox", { name: "报价方名称" });
  await sellerName.fill("Task18 清空持久性哨兵");
  await expect(page.getByText("草稿已保存在当前设备")).toBeVisible();
  await page.getByRole("button", { name: "草稿管理" }).click();
  const manager = page.getByRole("dialog", { name: "草稿管理" });
  await manager.getByRole("button", { name: "清空全部本机数据" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "确认清空本机数据" });
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(sellerName).toHaveValue("Task18 清空持久性哨兵");

  await manager.getByRole("button", { name: "清空全部本机数据" }).click();
  await page
    .getByRole("alertdialog", { name: "确认清空本机数据" })
    .getByRole("button", { name: "确认清空" })
    .click();
  await expect(page.getByText("本机报价数据已清空，并已建立新草稿")).toBeVisible();
  await expect(sellerName).toHaveValue("报价方");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "报价方名称" })).toHaveValue("报价方");
  await expect(page.getByRole("textbox", { name: "报价方名称" })).not.toHaveValue(
    "Task18 清空持久性哨兵",
  );
});

test.describe("900px editor", () => {
  test.use({ viewport: { width: 900, height: 1_000 } });

  test("places the A4 preview below the form without page overflow", async ({ page }) => {
    await openEditor(page, "quotation.service.project.v1", "项目服务报价单");
    const form = await page.getByLabel("文书填写区").boundingBox();
    const preview = await page.locator(".document-editor-v2__preview-column").boundingBox();
    expect(form).not.toBeNull();
    expect(preview).not.toBeNull();
    expect((preview?.y ?? 0) + 1).toBeGreaterThanOrEqual((form?.y ?? 0) + (form?.height ?? 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});

test.describe("mobile editor", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("switches tabs by pointer and keyboard without horizontal page overflow", async ({
    page,
  }) => {
    await openEditor(page, "contract.sale.domestic-b2b.v1", "国内货物销售合同");
    const fillTab = page.getByRole("tab", { name: "填写" });
    const previewTab = page.getByRole("tab", { name: "预览" });
    await expect(fillTab).toHaveAttribute("aria-selected", "true");
    await fillTab.press("End");
    await expect(previewTab).toBeFocused();
    await expect(previewTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "预览" })).toBeVisible();
    await previewTab.press("Home");
    await expect(fillTab).toBeFocused();
    await previewTab.click();
    await expect(page.getByRole("tabpanel", { name: "预览" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
