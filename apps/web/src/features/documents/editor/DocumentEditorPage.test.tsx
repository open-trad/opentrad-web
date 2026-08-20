import { readFileSync } from "node:fs";
import { v2 } from "@opentrad/document-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DocumentRepositoryV2,
  documentStorageKey,
  type StoredDocumentV2,
} from "../storage/documentRepository";
import { DocumentEditorPage } from "./DocumentEditorPage";

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

    for (let index = 0; index < 8 && document.activeElement !== previewTab; index += 1) {
      await user.tab();
    }
    expect(previewTab).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(previewTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "A4 文书预览" })).toHaveFocus();

    fillTab.focus();
    await user.keyboard(" ");
    expect(fillTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "文书填写区" })).toHaveFocus();
  });
});
