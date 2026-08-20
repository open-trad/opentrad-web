import { readFileSync } from "node:fs";
import { v2 } from "@opentrad/document-core";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportProjectV2Zip, PROJECT_V2_ZIP_MIME } from "../project/projectV2Files";
import {
  type DocumentRepositoryV2,
  documentStorageKey,
  type StoredDocumentV2,
} from "../storage/documentRepository";
import { prepareAttachmentAddition } from "./attachments";
import { DocumentEditorPage } from "./DocumentEditorPage";
import { setDraftField } from "./fieldPaths";

const V2_TEMPLATE_IDS = v2.TEMPLATE_IDS_V2;
const BID_TEMPLATE_IDS = V2_TEMPLATE_IDS.filter((templateId) => templateId.startsWith("bid."));
const NOW = "2026-08-20T08:00:00.000Z";
const editorStyles = readFileSync("src/styles.css", "utf8");

function stored(envelope: v2.ProjectEnvelopeV2, revision: number): StoredDocumentV2 {
  const registration = v2.V2_TEMPLATE_REGISTRY.get(envelope.template.id, envelope.template.version);
  return {
    key: documentStorageKey(envelope),
    documentId: envelope.draft.id,
    templateId: envelope.template.id,
    templateVersion: envelope.template.version,
    templateKey: `${envelope.template.id}@${envelope.template.version}`,
    envelope,
    model: registration.compile(envelope.draft as never) as v2.DocumentModelV2,
    revision,
    savedAt: NOW,
  };
}

function fakeRepository(): DocumentRepositoryV2 {
  let current: StoredDocumentV2 | null = null;
  return {
    commit: vi.fn(async (input) => {
      current = stored(input.envelope as v2.ProjectEnvelopeV2, (current?.revision ?? 0) + 1);
      return current;
    }),
    get: vi.fn(async (key) => (current?.key === key ? current : null)),
    getCurrent: vi.fn(async () => current),
    list: vi.fn(async () => (current ? [current] : [])),
    listAttachments: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function multiDocumentRepository(
  current: StoredDocumentV2,
  documents: readonly StoredDocumentV2[],
): DocumentRepositoryV2 {
  const records = new Map(documents.map((document) => [document.key, document]));
  let active = current;
  records.set(current.key, current);
  return {
    commit: vi.fn(async (input) => {
      const envelope = input.envelope as v2.ProjectEnvelopeV2;
      const key = documentStorageKey(envelope);
      const previous = records.get(key);
      const next = stored(envelope, (previous?.revision ?? 0) + 1);
      records.set(key, next);
      if (input.makeCurrent) active = next;
      return next;
    }),
    get: vi.fn(async (key) => records.get(key) ?? null),
    getCurrent: vi.fn(async () => active),
    list: vi.fn(async () => [...records.values()]),
    listAttachments: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function renderEditor(templateId: string, repository = fakeRepository()) {
  return {
    repository,
    ...render(
      <MemoryRouter initialEntries={[`/editor/${templateId}`]}>
        <Routes>
          <Route
            path="/editor/:templateId"
            element={
              <DocumentEditorPage
                workspaceOptions={{ repository, now: () => NOW, autosaveDelayMs: 0 }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    ),
  };
}

function projectEnvelope(templateId: string, id: string): v2.ProjectEnvelopeV2 {
  const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
  return {
    formatVersion: "2.0.0",
    template: {
      id: registration.definition.id,
      version: registration.definition.version,
      basisDate: registration.definition.basisDate,
    },
    draft: registration.createDraft({ id, now: NOW }) as v2.ProjectDraftV2,
    presentation: {
      layoutStyleId: registration.definition.defaultLayout,
      languageView: registration.definition.defaultLanguage,
    },
    attachmentManifest: [],
  };
}

async function zipFile(
  envelope: v2.ProjectEnvelopeV2,
  attachments: readonly {
    readonly id: string;
    readonly mediaType: "application/pdf" | "image/png" | "image/jpeg";
    readonly pageCount: number;
    readonly bytes: Uint8Array;
  }[] = [],
): Promise<File> {
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
          reader.onload = () =>
            reader.result instanceof ArrayBuffer
              ? resolve(reader.result)
              : reject(new Error("blob read failed"));
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
  const blob = await exportProjectV2Zip({
    envelope,
    attachments,
    registry: v2.V2_TEMPLATE_REGISTRY,
  });
  return new File([await blob.arrayBuffer()], "本地项目.opentrad", {
    type: PROJECT_V2_ZIP_MIME,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("generic V2 document editor page", () => {
  it.each(BID_TEMPLATE_IDS)(
    "uses Chinese navigation labels for every %s section",
    async (templateId) => {
      renderEditor(templateId);
      const navigation = await screen.findByRole("complementary", { name: "文书章节" });

      for (const button of within(navigation).getAllByRole("button")) {
        expect(button).toHaveTextContent(/\p{Script=Han}/u);
      }
    },
  );

  it("names the government-goods plan sections instead of exposing schema keys", async () => {
    renderEditor("bid.government.goods.v1");
    const navigation = await screen.findByRole("complementary", { name: "文书章节" });

    expect(within(navigation).getByRole("button", { name: /交付与安装/u })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: /培训与验收/u })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: /质保与售后/u })).toBeVisible();
    expect(
      within(navigation).queryByText(/^(delivery|training|warranty)$/u),
    ).not.toBeInTheDocument();
  });

  it("stacks preview below the steps and form at the 900 px visual breakpoint", () => {
    expect(editorStyles).toContain(
      "grid-template-columns: clamp(144px, 12.5vw, 180px) minmax(320px, 0.92fr) minmax(390px, 1.08fr)",
    );
    const compactStart = editorStyles.indexOf("@media (max-width: 999px)");
    const mobileStart = editorStyles.indexOf("@media (max-width: 599px)");
    expect(compactStart).toBeGreaterThan(-1);
    const compactLayout = editorStyles.slice(compactStart, mobileStart);
    expect(compactLayout).toContain("grid-template-columns: 150px minmax(0, 1fr)");
    expect(compactLayout).toMatch(
      /\.document-editor-v2__preview-column\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/su,
    );
  });

  it.each(V2_TEMPLATE_IDS)("opens %s at the exact published version", async (templateId) => {
    renderEditor(templateId);
    const definition = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0").definition;

    expect((await screen.findAllByRole("heading", { name: definition.name }))[0]).toBeVisible();
    expect(screen.getByText(`${templateId} · 1.0.0`)).toBeVisible();
    expect(screen.getByText("所有文书内容仅保存在当前设备")).toBeVisible();
    expect(screen.getByRole("region", { name: "文书填写区" })).toBeVisible();
    expect(screen.getByRole("region", { name: "A4 文书预览" })).toBeVisible();
  });

  it("renders a real unknown-version error with a template-centre return link", () => {
    renderEditor("not-a-published-template");

    expect(screen.getByRole("heading", { name: "模板版本不存在" })).toBeVisible();
    expect(screen.getByText(/not-a-published-template@1.0.0/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "返回模板中心" })).toHaveAttribute(
      "href",
      "/templates",
    );
  });

  it("edits a scalar and repeatable row, updates preview, and autosaves locally", async () => {
    const user = userEvent.setup();
    const { repository } = renderEditor("quotation.service.project.v1");
    const projectName = await screen.findByRole("textbox", { name: /项目名称.*必填/u });

    await user.clear(projectName);
    await user.type(projectName, "工厂节能改造咨询");
    await user.click(screen.getByRole("button", { name: "添加服务报价项" }));

    const preview = screen.getByRole("region", { name: "A4 文书预览" });
    expect(within(preview).getAllByText("工厂节能改造咨询")[0]).toBeVisible();
    expect(screen.getAllByRole("group", { name: /服务报价项 第 \d+ 项/u })).toHaveLength(2);
    expect(await screen.findByText("已保存到本机")).toBeVisible();
    expect(repository.commit).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 1, attachmentChanges: [] }),
    );
  });

  it("requires manual PDF page confirmation and supports atomic contract attachment removal", async () => {
    const user = userEvent.setup();
    const { repository } = renderEditor("contract.oem.processing.v1");
    const input = await screen.findByLabelText(/图纸附件.*必填/u);
    const file = new File([new TextEncoder().encode("%PDF-1.7\n%%EOF")], "工艺图纸.pdf", {
      type: "application/pdf",
    });

    await user.upload(input, file);
    const confirm = screen.getByRole("region", { name: "确认附件信息" });
    const attach = within(confirm).getByRole("button", { name: "附加到本机文书" });
    expect(attach).toBeDisabled();
    await user.type(within(confirm).getByLabelText("PDF 页数（请人工确认）"), "2");
    await user.click(
      within(confirm).getByRole("checkbox", {
        name: /我已人工核对 PDF 页数/u,
      }),
    );
    await user.click(attach);

    const inventory = await screen.findByRole("region", { name: "本机附件" });
    expect(within(inventory).getByText("工艺图纸.pdf")).toBeVisible();
    expect(within(inventory).getByText("2 页")).toBeVisible();
    expect(repository.commit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attachmentChanges: [expect.objectContaining({ type: "put", pageCountConfirmed: true })],
      }),
    );

    await user.click(within(inventory).getByRole("button", { name: "删除附件" }));
    expect(screen.queryByRole("region", { name: "本机附件" })).not.toBeInTheDocument();
  });

  it("previews a local project ZIP but cancel, invalid, and mismatched inputs never write", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { repository } = renderEditor("quotation.service.project.v1");
    const input = await screen.findByLabelText("导入本地项目 ZIP");
    expect(input.getAttribute("accept")?.split(",")).toContain(".opentrad");
    expect(input).toHaveAttribute("accept", expect.stringContaining(PROJECT_V2_ZIP_MIME));
    const registration = v2.V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const base = projectEnvelope("quotation.service.project.v1", "import-service");
    const importedDraft = registration.parseDraft(
      setDraftField(base.draft, "project.projectName", "ZIP 中的能源咨询项目"),
    ) as v2.ProjectDraftV2;
    const valid = await zipFile({ ...base, draft: importedDraft });

    await user.upload(input, valid);
    const dialog = await screen.findByRole("dialog", { name: "确认导入本地项目" });
    expect(within(dialog).getByText("quotation.service.project.v1@1.0.0")).toBeVisible();
    expect(within(dialog).getByText("0 个附件")).toBeVisible();
    expect(repository.commit).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "取消导入" }));
    expect(screen.queryByRole("dialog", { name: "确认导入本地项目" })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(repository.commit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: /项目名称.*必填/u })).toHaveValue("待填写");

    const invalid = new File([new Uint8Array([1, 2, 3])], "损坏项目.zip", {
      type: PROJECT_V2_ZIP_MIME,
    });
    await user.upload(input, invalid);
    expect(await screen.findByRole("alert")).toHaveTextContent(/项目 ZIP 无效|项目包/u);
    expect(input).toHaveFocus();
    expect(repository.commit).toHaveBeenCalledTimes(1);

    const oversized = new File([new Uint8Array([1])], "超大项目.zip", {
      type: PROJECT_V2_ZIP_MIME,
    });
    Object.defineProperty(oversized, "size", { value: 53 * 1024 * 1024 });
    await user.upload(input, oversized);
    expect(await screen.findByRole("alert")).toHaveTextContent("项目包超过 52 MiB");
    expect(input).toHaveFocus();

    const mismatch = await zipFile(projectEnvelope("contract.oem.processing.v1", "other-template"));
    await user.upload(input, mismatch);
    expect(await screen.findByRole("alert")).toHaveTextContent(/模板或版本与当前编辑器不一致/u);
    expect(screen.queryByRole("dialog", { name: "确认导入本地项目" })).not.toBeInTheDocument();
    expect(repository.commit).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("commits a confirmed same-template ZIP and its attachments atomically before hydrating", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const templateId = "contract.oem.processing.v1";
    const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
    const field = registration.definition.fieldManifest.find(
      (entry) => entry.path === "technical.drawingAttachmentIds",
    );
    if (!field || field.control !== "attachment") throw new Error("missing drawing attachment");
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const transaction = await prepareAttachmentAddition({
      registration,
      envelope: projectEnvelope(templateId, "import-contract"),
      field,
      path: field.path,
      attachmentId: "drawing-imported",
      displayName: "导入工艺图.png",
      blob: new Blob([pngBytes], { type: "image/png" }),
      pageCount: 1,
      documentKind: "contract",
      savedAt: NOW,
      existingRecords: [],
    });
    const repository = multiDocumentRepository(
      stored(projectEnvelope(templateId, "current-contract"), 3),
      [stored(transaction.envelope, 7)],
    );
    renderEditor(templateId, repository);
    const input = await screen.findByLabelText("导入本地项目 ZIP");
    const importedFile = await zipFile(transaction.envelope, [
      { id: "drawing-imported", mediaType: "image/png", pageCount: 1, bytes: pngBytes },
    ]);

    await user.upload(input, importedFile);
    const dialog = await screen.findByRole("dialog", { name: "确认导入本地项目" });
    expect(within(dialog).getByText("1 个附件")).toBeVisible();
    expect(repository.commit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "确认并导入" }));

    const inventory = await screen.findByRole("region", { name: "本机附件" });
    expect(within(inventory).getByText("导入工艺图.png")).toBeVisible();
    await waitFor(() => expect(repository.commit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已保存到本机")).toBeVisible();
    expect(repository.commit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 7,
        makeCurrent: true,
        attachmentChanges: [
          expect.objectContaining({
            type: "put",
            attachmentId: "drawing-imported",
            blob: expect.any(Blob),
          }),
        ],
      }),
    );
    const committedChange = vi.mocked(repository.commit).mock.calls[0]?.[0].attachmentChanges[0];
    if (!committedChange || committedChange.type !== "put") {
      throw new Error("missing imported attachment put");
    }
    expect(new Uint8Array(await committedChange.blob.arrayBuffer())).toEqual(pngBytes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses native keyboard-operable fill/preview tabs below 600 px and moves focus", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(max-width: 599px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    renderEditor("quotation.service.project.v1");
    await screen.findAllByRole("heading", { name: "项目服务报价单" });
    const fillTab = screen.getByRole("tab", { name: "填写" });
    const previewTab = screen.getByRole("tab", { name: "预览" });
    const fillPanelId = fillTab.getAttribute("aria-controls");
    const previewPanelId = previewTab.getAttribute("aria-controls");
    expect(fillPanelId).toBeTruthy();
    expect(previewPanelId).toBeTruthy();
    const fillPanel = document.getElementById(fillPanelId ?? "");
    const previewPanel = document.getElementById(previewPanelId ?? "");
    expect(fillPanel).toHaveAttribute("role", "tabpanel");
    expect(fillPanel).toHaveAttribute("aria-labelledby", fillTab.id);
    expect(previewPanel).toHaveAttribute("role", "tabpanel");
    expect(previewPanel).toHaveAttribute("aria-labelledby", previewTab.id);
    expect(fillTab).toHaveAttribute("tabindex", "0");
    expect(previewTab).toHaveAttribute("tabindex", "-1");

    fillTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(previewTab).toHaveFocus();
    expect(previewTab).toHaveAttribute("aria-selected", "true");
    expect(previewTab).toHaveAttribute("tabindex", "0");
    expect(fillTab).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowLeft}");
    expect(fillTab).toHaveFocus();
    await user.keyboard("{End}");
    expect(previewTab).toHaveFocus();
    await user.keyboard("{Home}");
    expect(fillTab).toHaveFocus();

    await user.click(previewTab);
    expect(previewTab).toHaveAttribute("aria-selected", "true");
    expect(previewPanel).toHaveFocus();

    await user.click(fillTab);
    expect(fillTab).toHaveAttribute("aria-selected", "true");
    expect(fillPanel).toHaveFocus();
  });

  it("keeps desktop editor regions free of mobile tab semantics", async () => {
    renderEditor("quotation.service.project.v1");
    await screen.findAllByRole("heading", { name: "项目服务报价单" });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "文书填写区" })).not.toHaveAttribute(
      "aria-labelledby",
    );
  });
});
