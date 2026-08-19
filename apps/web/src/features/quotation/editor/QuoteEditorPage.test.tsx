import {
  createStandardGoodsQuoteDraft,
  type StandardGoodsQuoteDraft,
  serializeProject,
} from "@opentrad/document-core";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteEditorPage } from "../../../pages/QuoteEditorPage";
import { prepareQuotationArtifacts } from "../project/projectFiles";
import type { CompanyProfile, QuotationRepository, StoredDraft } from "../storage/repository";
import type { QuotationExportDependencies } from "./exportQuotation";

function stored(draft: StandardGoodsQuoteDraft): StoredDraft {
  return { id: draft.id, draft, revision: 1, savedAt: draft.updatedAt };
}

function fakeRepository(current: StandardGoodsQuoteDraft): QuotationRepository {
  return {
    saveDraft: vi.fn(async (draft: unknown) => stored(draft as StandardGoodsQuoteDraft)),
    getDraft: vi.fn(async () => null),
    getCurrentDraft: vi.fn(async () => current),
    listDrafts: vi.fn(async () => []),
    deleteDraft: vi.fn(async () => undefined),
    saveCompanyProfile: vi.fn(async (input: unknown) => input as never),
    listCompanyProfiles: vi.fn(async () => []),
    deleteCompanyProfile: vi.fn(async () => undefined),
    clearAllLocalData: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function statefulRepository(current: StandardGoodsQuoteDraft) {
  const drafts = new Map([[current.id, current]]);
  let currentId = current.id;
  let profiles: CompanyProfile[] = [];
  const repository: QuotationRepository = {
    saveDraft: vi.fn(async (input: unknown, options) => {
      const draft = input as StandardGoodsQuoteDraft;
      drafts.set(draft.id, draft);
      if (options.makeCurrent) currentId = draft.id;
      return stored(draft);
    }),
    getDraft: vi.fn(async (id) => drafts.get(id) ?? null),
    getCurrentDraft: vi.fn(async () => drafts.get(currentId) ?? null),
    listDrafts: vi.fn(async () => Array.from(drafts.values()).map(stored)),
    deleteDraft: vi.fn(async (id) => {
      drafts.delete(id);
    }),
    saveCompanyProfile: vi.fn(async (input: unknown) => {
      const profile = input as CompanyProfile;
      profiles = [profile, ...profiles.filter((item) => item.id !== profile.id)];
      return profile;
    }),
    listCompanyProfiles: vi.fn(async () => profiles),
    deleteCompanyProfile: vi.fn(async (id) => {
      profiles = profiles.filter((item) => item.id !== id);
    }),
    clearAllLocalData: vi.fn(async () => {
      drafts.clear();
      profiles = [];
    }),
    close: vi.fn(),
  };
  return repository;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderEditor(
  options: {
    mobile?: boolean;
    repository?: QuotationRepository;
    createId?: () => string;
    exportDependencies?: QuotationExportDependencies;
  } = {},
) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: options.mobile ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  const draft = createStandardGoodsQuoteDraft({
    id: "draft-editor-test",
    now: "2026-08-19T10:00:00.000Z",
  });
  const repository = options.repository ?? fakeRepository(draft);
  const rendered = render(
    <QuoteEditorPage
      workspaceOptions={{
        repository,
        now: () => "2026-08-19T11:00:00.000Z",
        createId: options.createId ?? (() => "unused"),
        autosaveDelayMs: 60_000,
      }}
      createLineId={() => "line-added-stable"}
      exportDependencies={options.exportDependencies}
    />,
  );
  return { ...rendered, repository };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("standard goods quotation editor", () => {
  it("uses five real step buttons and blocks forward navigation at the first linked error", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("heading", { name: "基本信息" });

    const steps = screen.getByRole("complementary", { name: "报价单步骤" });
    for (const label of ["基本信息", "客户信息", "商品明细", "条款与备注", "审核与完成"]) {
      expect(within(steps).getByRole("button", { name: new RegExp(label) })).toBeEnabled();
    }
    expect(within(steps).getByRole("button", { name: /基本信息/ })).toHaveAttribute(
      "aria-current",
      "step",
    );

    const sellerName = screen.getByRole("textbox", { name: "报价方名称" });
    await user.clear(sellerName);
    await user.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByRole("heading", { name: "基本信息" })).toBeVisible();
    expect(sellerName).toHaveAttribute("aria-invalid", "true");
    expect(sellerName).toHaveAttribute("aria-describedby", "seller-name-error");
    expect(screen.getByText("请填写报价方名称")).toHaveAttribute("id", "seller-name-error");
    expect(sellerName).toHaveFocus();

    await user.type(sellerName, "宁波远航贸易有限公司");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByRole("heading", { name: "客户信息" })).toHaveFocus();
    expect(within(steps).getByRole("button", { name: /基本信息/ })).toHaveAttribute(
      "data-completed",
      "true",
    );
  });

  it("can return to the earliest invalid step but cannot navigate past it", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("heading", { name: "基本信息" });

    const steps = screen.getByRole("complementary", { name: "报价单步骤" });
    await user.click(within(steps).getByRole("button", { name: /商品明细/ }));
    const quantity = screen.getByRole("textbox", { name: "第 1 行数量" });
    await user.clear(quantity);
    await user.type(quantity, "0");
    await user.click(within(steps).getByRole("button", { name: /基本信息/ }));

    await user.click(within(steps).getByRole("button", { name: /商品明细/ }));
    expect(await screen.findByRole("heading", { name: "商品明细" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^第 1 行数量/ })).toHaveFocus();

    await user.click(within(steps).getByRole("button", { name: /基本信息/ }));
    await user.click(within(steps).getByRole("button", { name: /条款与备注/ }));
    expect(await screen.findByRole("heading", { name: "商品明细" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^第 1 行数量/ })).toHaveFocus();
    expect(screen.queryByRole("heading", { name: "条款与备注" })).not.toBeInTheDocument();
  });

  it("edits the full seller, buyer and metadata field set through labeled controls", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("heading", { name: "基本信息" });

    const edits: Array<[string, string]> = [
      ["报价编号", "QT-CN-2026-001"],
      ["报价方名称", "宁波远航贸易有限公司"],
      ["报价方地址", "宁波市海曙区商贸路 128 号"],
      ["报价方联系人", "林经理"],
      ["报价方电话", "0574-12345678"],
      ["报价方邮箱", "sales@example.cn"],
      ["报价方税号", "91330200TEST"],
      ["报价方开户行", "中国银行宁波分行"],
      ["报价方银行账号", "622200001"],
    ];
    for (const [label, value] of edits) {
      const field = screen.getByRole("textbox", { name: label });
      await user.clear(field);
      await user.type(field, value);
      expect(field).toHaveValue(value);
    }
    await user.selectOptions(screen.getByRole("combobox", { name: "币种" }), "USD");
    await user.selectOptions(screen.getByRole("combobox", { name: "税制" }), "tax-included");
    await user.selectOptions(screen.getByRole("combobox", { name: "报价性质" }), "binding-offer");
    await user.click(screen.getByRole("button", { name: "下一步" }));

    for (const [label, value] of [
      ["采购方名称", "海湾采购集团"],
      ["采购方地址", "上海市浦东新区"],
      ["采购方联系人", "周经理"],
      ["采购方电话", "021-12345678"],
      ["采购方邮箱", "buy@example.cn"],
      ["采购方税号", "91310000TEST"],
      ["采购方开户行", "招商银行上海分行"],
      ["采购方银行账号", "622200002"],
    ] satisfies Array<[string, string]>) {
      const field = screen.getByRole("textbox", { name: label });
      await user.clear(field);
      await user.type(field, value);
      expect(field).toHaveValue(value);
    }
    const preview = screen.getByRole("region", { name: "A4 报价单预览" });
    expect(within(preview).getByText("QT-CN-2026-001")).toBeVisible();
    expect(within(preview).getByText("宁波远航贸易有限公司")).toBeVisible();
    expect(within(preview).getByText("海湾采购集团")).toBeVisible();
  });

  it("adds and deletes stable line items, shows core totals, and normalizes tax-exempt rates", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("heading", { name: "基本信息" });
    await user.click(screen.getByRole("button", { name: /商品明细/ }));
    expect(await screen.findByRole("heading", { name: "商品明细" })).toBeVisible();

    const price = screen.getByRole("textbox", { name: "第 1 行单价" });
    await user.clear(price);
    await user.type(price, "100.00");
    const quantity = screen.getByRole("textbox", { name: "第 1 行数量" });
    await user.clear(quantity);
    await user.type(quantity, "2");
    const discount = screen.getByRole("textbox", { name: "第 1 行折扣百分比" });
    await user.clear(discount);
    await user.type(discount, "10");
    const tax = screen.getByRole("textbox", { name: "第 1 行税率百分比" });
    await user.clear(tax);
    await user.type(tax, "13");
    expect(
      within(screen.getByRole("region", { name: "报价金额汇总" })).getByText("CNY 203.40"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "添加商品" }));
    expect(screen.getByRole("textbox", { name: "第 2 行商品名称" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "删除第 2 行商品" }));
    expect(screen.queryByRole("textbox", { name: "第 2 行商品名称" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除第 1 行商品" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /基本信息/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "税制" }), "tax-exempt");
    await user.click(screen.getByRole("button", { name: /商品明细/ }));
    expect(screen.getByRole("textbox", { name: "第 1 行税率百分比" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "第 1 行税率百分比" })).toHaveValue("0");
    expect(
      within(screen.getByRole("region", { name: "报价金额汇总" })).getByText("CNY 180.00"),
    ).toBeVisible();
  });

  it("keeps invalid raw values visible, flags stale preview, and moves focus on mobile toggle", async () => {
    const user = userEvent.setup();
    renderEditor({ mobile: true });
    await screen.findByRole("heading", { name: "基本信息" });
    await user.click(screen.getByRole("button", { name: /商品明细/ }));
    const price = screen.getByRole("textbox", { name: "第 1 行单价" });
    await user.clear(price);
    await user.type(price, "1.005");
    expect(price).toHaveValue("1.005");
    expect(screen.getByText("预览等待修正后更新")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "查看文档预览" }));
    expect(screen.getByRole("region", { name: "A4 报价单预览" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "返回填写" }));
    expect(screen.getByRole("region", { name: "报价单填写区" })).toHaveFocus();
  });

  it("runs all four export actions through the injected seam with finite progress feedback", async () => {
    const user = userEvent.setup();
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-export-ui",
      now: "2026-08-19T10:00:00.000Z",
    });
    const artifacts = prepareQuotationArtifacts(draft);
    const dependencies: QuotationExportDependencies = {
      prepare: vi.fn(() => artifacts),
      renderDocx: vi.fn(async () => new Blob(["docx"])),
      renderPdf: vi.fn(async () => new Blob(["pdf"])),
      createProject: vi.fn((_prepared, format) => ({
        blob: new Blob([format]),
        filename: `quote.${format}`,
      })),
      download: vi.fn(),
      buildFilename: vi.fn((_basename, extension) => `quote.${extension}`),
    };
    renderEditor({ repository: statefulRepository(draft), exportDependencies: dependencies });
    await screen.findByRole("heading", { name: "基本信息" });
    await user.click(screen.getByRole("button", { name: /审核与完成/ }));

    for (const label of ["导出 DOCX", "导出 PDF", "导出 JSON", "导出 OPENTRAD"]) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(await screen.findByText(/导出成功/)).toBeVisible();
    }
    expect(dependencies.prepare).toHaveBeenCalledTimes(4);
    expect(dependencies.download).toHaveBeenCalledTimes(4);
    expect(dependencies.renderDocx).toHaveBeenCalledTimes(1);
    expect(dependencies.renderPdf).toHaveBeenCalledTimes(1);
    expect(dependencies.createProject).toHaveBeenCalledTimes(2);
  });

  it("manages company profiles and returns focus when its dialog closes with Escape", async () => {
    const user = userEvent.setup();
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-profile-ui",
      now: "2026-08-19T10:00:00.000Z",
    });
    draft.seller.name = "宁波远航贸易有限公司";
    const repository = statefulRepository(draft);
    const ids = ["profile-ui-1"];
    renderEditor({ repository, createId: () => ids.shift() ?? "unused" });
    await screen.findByRole("heading", { name: "基本信息" });

    const opener = screen.getByRole("button", { name: "公司档案" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "公司档案" });
    expect(within(dialog).getByRole("button", { name: "关闭公司档案" })).toHaveFocus();
    expect(within(dialog).getByText("还没有公司档案")).toBeVisible();
    await user.type(within(dialog).getByRole("textbox", { name: "档案名称" }), "默认出口公司");
    await user.click(within(dialog).getByRole("button", { name: "保存当前报价方" }));
    expect(await within(dialog).findByText("默认出口公司")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "应用默认出口公司" }));
    const deleteProfile = within(dialog).getByRole("button", { name: "删除默认出口公司" });
    await user.click(deleteProfile);
    const profileConfirm = screen.getByRole("alertdialog", { name: "确认删除公司档案" });
    expect(within(profileConfirm).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(within(profileConfirm).getByRole("button", { name: "取消" }));
    expect(deleteProfile).toHaveFocus();
    await user.click(deleteProfile);
    await user.click(
      within(screen.getByRole("alertdialog", { name: "确认删除公司档案" })).getByRole("button", {
        name: "确认删除",
      }),
    );
    expect(within(dialog).queryByText("默认出口公司")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "公司档案" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("requires explicit confirmation for draft deletion, clear-all and safe-copy import", async () => {
    const user = userEvent.setup();
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-manager-ui",
      now: "2026-08-19T10:00:00.000Z",
    });
    const repository = statefulRepository(draft);
    const ids = ["draft-new-ui", "safe-import-ui", "draft-after-clear-ui"];
    renderEditor({ repository, createId: () => ids.shift() ?? "unused" });
    await screen.findByRole("heading", { name: "基本信息" });

    await user.click(screen.getByRole("button", { name: "草稿管理" }));
    const draftDialog = screen.getByRole("dialog", { name: "草稿管理" });
    expect(within(draftDialog).getByRole("button", { name: "关闭草稿管理" })).toHaveFocus();
    await user.click(within(draftDialog).getByRole("button", { name: "新建草稿" }));
    const deleteButton = within(draftDialog).getAllByRole("button", { name: /删除草稿/ })[0];
    if (!deleteButton) throw new Error("Expected a saved draft delete action");
    await user.click(deleteButton);
    const deleteConfirm = screen.getByRole("alertdialog", { name: "确认删除草稿" });
    expect(within(deleteConfirm).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(within(deleteConfirm).getByRole("button", { name: "取消" }));
    expect(repository.deleteDraft).not.toHaveBeenCalled();
    expect(deleteButton).toHaveFocus();
    await user.click(deleteButton);
    await user.click(
      within(screen.getByRole("alertdialog", { name: "确认删除草稿" })).getByRole("button", {
        name: "确认删除",
      }),
    );
    expect(repository.deleteDraft).toHaveBeenCalledTimes(1);
    await user.click(within(draftDialog).getByRole("button", { name: "清空全部本机数据" }));
    await user.click(
      within(screen.getByRole("alertdialog", { name: "确认清空本机数据" })).getByRole("button", {
        name: "取消",
      }),
    );
    expect(repository.clearAllLocalData).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");

    const imported = createStandardGoodsQuoteDraft({
      id: "untrusted-ui-id",
      now: "2026-08-18T10:00:00.000Z",
    });
    imported.seller.name = "安全导入公司";
    const serialized = serializeProject(imported);
    const file = new File([serialized], "safe.opentrad", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => serialized });
    const importButton = screen.getByRole("button", { name: "导入项目" });
    const input = screen.getByLabelText("选择 OpenTrad 项目文件");
    await user.upload(input, file);
    const importConfirm = screen.getByRole("alertdialog", { name: "确认导入项目" });
    expect(within(importConfirm).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(within(importConfirm).getByRole("button", { name: "取消" }));
    expect(importButton).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "报价方名称" })).toHaveValue("报价方");
    await user.upload(input, file);
    await user.click(
      within(screen.getByRole("alertdialog", { name: "确认导入项目" })).getByRole("button", {
        name: "作为新草稿副本导入",
      }),
    );
    expect(await screen.findByText(/项目已作为新的本机草稿副本导入/)).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "A4 报价单预览" })).getByText("安全导入公司"),
    ).toBeVisible();
  });

  it("prevents a second new-draft action while the first request is pending", async () => {
    const user = userEvent.setup();
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-before-deferred-new",
      now: "2026-08-19T10:00:00.000Z",
    });
    const repository = statefulRepository(draft);
    const pendingSave = deferred<StoredDraft>();
    vi.mocked(repository.saveDraft).mockImplementationOnce(() => pendingSave.promise);
    const ids = ["deferred-new-first", "deferred-new-second"];
    renderEditor({ repository, createId: () => ids.shift() ?? "unused" });
    await screen.findByRole("heading", { name: "基本信息" });
    await user.click(screen.getByRole("button", { name: "草稿管理" }));
    const dialog = screen.getByRole("dialog", { name: "草稿管理" });
    const newButton = within(dialog).getByRole("button", { name: "新建草稿" });

    act(() => {
      newButton.click();
      newButton.click();
    });
    await waitFor(() => expect(repository.saveDraft).toHaveBeenCalled());
    const callsWhilePending = vi.mocked(repository.saveDraft).mock.calls.length;
    const busyWhilePending = dialog.getAttribute("aria-busy");
    const disabledWhilePending = newButton.hasAttribute("disabled");
    await act(async () => {
      pendingSave.resolve(stored(draft));
      await pendingSave.promise;
    });
    await screen.findByText("已新建本机草稿");

    expect(callsWhilePending).toBe(1);
    expect(busyWhilePending).toBe("true");
    expect(disabledWhilePending).toBe(true);
    expect(newButton).toBeEnabled();
    expect(dialog).toHaveAttribute("aria-busy", "false");
  });

  it("prevents a second load-draft action while the first request is pending", async () => {
    const user = userEvent.setup();
    const current = createStandardGoodsQuoteDraft({
      id: "draft-before-deferred-load",
      now: "2026-08-19T10:00:00.000Z",
    });
    const target = createStandardGoodsQuoteDraft({
      id: "draft-target-deferred-load",
      now: "2026-08-19T10:10:00.000Z",
    });
    target.meta.number = "QT-DEFERRED-LOAD";
    const repository = statefulRepository(current);
    await repository.saveDraft(target, {
      makeCurrent: false,
      savedAt: "2026-08-19T10:10:00.000Z",
    });
    vi.mocked(repository.saveDraft).mockClear();
    const pendingLoad = deferred<StandardGoodsQuoteDraft | null>();
    vi.mocked(repository.getDraft).mockImplementationOnce(() => pendingLoad.promise);
    renderEditor({ repository });
    await screen.findByRole("heading", { name: "基本信息" });
    await user.click(screen.getByRole("button", { name: "草稿管理" }));
    const dialog = screen.getByRole("dialog", { name: "草稿管理" });
    const loadButton = await within(dialog).findByRole("button", {
      name: "载入草稿：QT-DEFERRED-LOAD",
    });

    act(() => {
      loadButton.click();
      loadButton.click();
    });
    await waitFor(() => expect(repository.getDraft).toHaveBeenCalled());
    const callsWhilePending = vi.mocked(repository.getDraft).mock.calls.length;
    const busyWhilePending = dialog.getAttribute("aria-busy");
    const disabledWhilePending = loadButton.hasAttribute("disabled");
    await act(async () => {
      pendingLoad.resolve(target);
      await pendingLoad.promise;
    });
    await screen.findByText("已切换到所选草稿");

    expect(callsWhilePending).toBe(1);
    expect(busyWhilePending).toBe("true");
    expect(disabledWhilePending).toBe(true);
    expect(loadButton).toBeEnabled();
    expect(dialog).toHaveAttribute("aria-busy", "false");
  });

  it("keeps destructive actions busy until success and focuses the visible import control after failure", async () => {
    const user = userEvent.setup();
    const draft = createStandardGoodsQuoteDraft({
      id: "draft-manager-failure",
      now: "2026-08-19T10:00:00.000Z",
    });
    const repository = statefulRepository(draft);
    const pendingDelete = deferred<void>();
    vi.mocked(repository.deleteDraft).mockImplementationOnce(() => pendingDelete.promise);
    renderEditor({ repository, createId: () => "safe-import-failure-id" });
    await screen.findByRole("heading", { name: "基本信息" });

    await user.click(screen.getByRole("button", { name: "草稿管理" }));
    const draftDialog = screen.getByRole("dialog", { name: "草稿管理" });
    await user.click(within(draftDialog).getByRole("button", { name: /删除草稿/ }));
    const deleteConfirm = screen.getByRole("alertdialog", { name: "确认删除草稿" });
    const confirmDelete = within(deleteConfirm).getByRole("button", { name: "确认删除" });
    await user.click(confirmDelete);
    expect(deleteConfirm).toHaveAttribute("aria-busy", "true");
    expect(confirmDelete).toBeDisabled();
    pendingDelete.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "确认删除草稿" })).not.toBeInTheDocument(),
    );
    await user.keyboard("{Escape}");

    vi.mocked(repository.saveDraft).mockRejectedValueOnce(new Error("secret storage detail"));
    const imported = createStandardGoodsQuoteDraft({
      id: "untrusted-failure-id",
      now: "2026-08-18T10:00:00.000Z",
    });
    const serialized = serializeProject(imported);
    const file = new File([serialized], "failure.opentrad", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => serialized });
    const importButton = screen.getByRole("button", { name: "导入项目" });
    await user.upload(screen.getByLabelText("选择 OpenTrad 项目文件"), file);
    const importConfirm = screen.getByRole("alertdialog", { name: "确认导入项目" });
    await user.click(within(importConfirm).getByRole("button", { name: "作为新草稿副本导入" }));
    expect(await screen.findByText("项目导入失败，请选择有效的 OpenTrad 项目文件")).toBeVisible();
    expect(screen.queryByRole("alertdialog", { name: "确认导入项目" })).not.toBeInTheDocument();
    expect(importButton).toHaveFocus();
  });
});
