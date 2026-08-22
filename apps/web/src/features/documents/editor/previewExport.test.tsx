import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { v2 } from "@opentrad/document-core";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectV2AttachmentFile } from "../project/projectV2Files";
import { BidPreflightPanel, resolveBidExportDecision } from "./BidPreflightPanel";
import { DocumentPreviewPanel } from "./DocumentPreviewPanel";
import { ExportPanel, type ExportPanelServices } from "./ExportPanel";
import type { DocumentRevisionSnapshot } from "./useDocumentWorkspace";

const NOW = "2026-08-20T08:00:00.000Z";
const BID_TEMPLATE_IDS = v2.TEMPLATE_IDS_V2.filter((templateId) => templateId.startsWith("bid."));

it("keeps the default PDF page inspector behind the explicit project-export action", () => {
  const source = readFileSync("src/features/documents/editor/ExportPanel.tsx", "utf8");
  expect(source).not.toContain('import { inspectPdf } from "@opentrad/conversion-local/pdf"');
  expect(source).toContain('await import("@opentrad/conversion-local/pdf")');
});

function snapshotFor(templateId: string): DocumentRevisionSnapshot {
  const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
  const draft = registration.createDraft({ id: "preview-export-test", now: NOW });
  const envelope = v2.ProjectEnvelopeV2Schema.parse({
    formatVersion: "2.0.0",
    template: {
      id: registration.definition.id,
      version: registration.definition.version,
      basisDate: registration.definition.basisDate,
    },
    draft,
    presentation: {
      layoutStyleId: registration.definition.defaultLayout,
      languageView: registration.definition.defaultLanguage,
    },
    attachmentManifest: [],
  });
  return {
    envelope,
    draft,
    model: registration.compile(draft as never) as v2.DocumentModelV2,
    findings: registration.preflight(draft as never),
  };
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Blob read failed"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(blob);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("V2 preview and local exports", () => {
  it("renders contract generation guidance as a separate preview page outside clauses", () => {
    const snapshot = snapshotFor("contract.sale.domestic-b2b.v1");
    render(<DocumentPreviewPanel snapshot={snapshot} stale />);

    const region = screen.getByRole("region", { name: "A4 文书预览" });
    expect(within(region).getByRole("article", { name: "国内货物销售合同" })).toHaveAttribute(
      "data-template-id",
      "contract.sale.domestic-b2b.v1",
    );
    expect(within(region).getByText("预览显示上一次有效内容")).toBeVisible();
    const instructionsPage = within(region).getByRole("article", {
      name: "合同生成说明预览页",
    });
    expect(instructionsPage).toHaveAttribute("data-preview-page", "generation-instructions");
    expect(instructionsPage).toHaveTextContent("不构成合同条款");
    expect(within(instructionsPage).queryByRole("article")).not.toBeInTheDocument();
    expect(within(instructionsPage).queryByText("合同条款")).not.toBeInTheDocument();
  });

  it("uses the exact same model snapshot for DOCX, PDF, and JSON without network calls", async () => {
    const user = userEvent.setup();
    const snapshot = snapshotFor("quotation.service.project.v1");
    const downloads: Array<{ blob: Blob; filename: string }> = [];
    const services: ExportPanelServices = {
      renderDocx: vi.fn(async () => new Blob(["docx"])),
      renderPdf: vi.fn(async () => new Blob(["pdf"])),
      inspectPdf: vi.fn(async () => ({ pageCount: 1, pages: [] })),
      exportProject: vi.fn(async () => new Blob(["zip"])),
      download: vi.fn((blob, filename) => downloads.push({ blob, filename })),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <ExportPanel
        snapshot={snapshot}
        attachments={[] satisfies readonly ProjectV2AttachmentFile[]}
        services={services}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下载 Word" }));
    await user.click(screen.getByRole("button", { name: "下载 PDF" }));
    await user.click(screen.getByRole("button", { name: "下载 JSON" }));
    await user.click(screen.getByRole("button", { name: "导出本地项目 ZIP" }));
    await waitFor(() => expect(downloads).toHaveLength(4));

    expect(services.renderDocx).toHaveBeenCalledWith(
      snapshot.model,
      snapshot.envelope.presentation.layoutStyleId,
      snapshot.envelope.presentation.languageView,
    );
    expect(services.renderPdf).toHaveBeenCalledWith(
      snapshot.model,
      snapshot.envelope.presentation.layoutStyleId,
      snapshot.envelope.presentation.languageView,
    );
    expect(await readBlobText(downloads[2]?.blob as Blob)).toContain(
      `"documentId":"${snapshot.model.documentId}"`,
    );
    expect(services.exportProject).toHaveBeenCalledWith({
      envelope: snapshot.envelope,
      attachments: [],
      registry: v2.V2_TEMPLATE_REGISTRY,
    });
    expect(downloads.map((item) => item.filename)).toEqual([
      expect.stringMatching(/\.docx$/u),
      expect.stringMatching(/\.pdf$/u),
      expect.stringMatching(/\.json$/u),
      expect.stringMatching(/\.opentrad$/u),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps project ZIP disabled until attachment bytes match the envelope revision", () => {
    const snapshot = snapshotFor("contract.sale.domestic-b2b.v1");
    render(<ExportPanel snapshot={snapshot} attachments={[]} projectAttachmentsReady={false} />);

    const zip = screen.getByRole("button", { name: "导出本地项目 ZIP" });
    expect(zip).toBeDisabled();
    expect(zip).toHaveAccessibleDescription("正在同步本机附件，项目 ZIP 暂不可用。");
  });

  it("shows finite export failures without leaking the thrown error", async () => {
    const user = userEvent.setup();
    const services: ExportPanelServices = {
      renderDocx: vi.fn(async () => {
        throw new Error("secret stack and local path");
      }),
      renderPdf: vi.fn(async () => new Blob()),
      inspectPdf: vi.fn(async () => ({ pageCount: 1, pages: [] })),
      exportProject: vi.fn(async () => new Blob()),
      download: vi.fn(),
    };
    render(
      <ExportPanel
        snapshot={snapshotFor("quotation.service.project.v1")}
        attachments={[]}
        services={services}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下载 Word" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败，请检查文书内容后重试");
    expect(screen.queryByText(/secret stack/u)).not.toBeInTheDocument();
  });
});

describe("bid preflight export boundary", () => {
  it("derives the bid body page hint from the same local PDF snapshot without network access", async () => {
    const user = userEvent.setup();
    const snapshot = snapshotFor("bid.government.goods.v1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const services = {
      renderDocx: vi.fn(async () => new Blob(["docx"])),
      renderPdf: vi.fn(async () => new NodeBlob(["%PDF-local"]) as Blob),
      inspectPdf: vi.fn(async () => ({ pageCount: 4, pages: [] })),
      exportProject: vi.fn(async () => new Blob(["zip"])),
      download: vi.fn(),
    } as unknown as ExportPanelServices;
    render(<ExportPanel snapshot={snapshot} attachments={[]} services={services} />);
    expect(snapshot.model.documentKind).toBe("bid");

    await user.click(screen.getByRole("button", { name: "导出本地项目 ZIP" }));
    await waitFor(() => expect(services.download).toHaveBeenCalledTimes(1));

    expect(services.renderPdf).toHaveBeenCalledWith(
      snapshot.model,
      snapshot.envelope.presentation.layoutStyleId,
      snapshot.envelope.presentation.languageView,
    );
    expect(services.inspectPdf).toHaveBeenCalledTimes(1);
    expect(services.exportProject).toHaveBeenCalledWith({
      envelope: snapshot.envelope,
      attachments: [],
      registry: v2.V2_TEMPLATE_REGISTRY,
      bidBodyPageCountHint: 4,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(BID_TEMPLATE_IDS)("localizes every default finding message for %s", (templateId) => {
    const snapshot = snapshotFor(templateId);
    const decision = resolveBidExportDecision(snapshot);
    const bareEnglishFindings = snapshot.findings.filter(
      (finding) => !/\p{Script=Han}/u.test(finding.message),
    );
    expect(bareEnglishFindings.length).toBeGreaterThan(0);

    render(<BidPreflightPanel snapshot={snapshot} decision={decision} />);

    for (const finding of bareEnglishFindings) {
      expect(screen.queryAllByText(finding.message, { exact: true })).toHaveLength(0);
      expect(screen.getAllByText(finding.code, { exact: true }).length).toBeGreaterThan(0);
    }
  });

  it("does not use browser time as a trusted asOf and keeps an unbound bid internal-only", () => {
    const snapshot = snapshotFor("bid.government.goods.v1");
    const decision = resolveBidExportDecision(snapshot);
    render(<BidPreflightPanel snapshot={snapshot} decision={decision} />);

    expect(decision.mode).toBe("internal-draft");
    expect(decision.canExportSubmission).toBe(false);
    expect(decision.submissionChecks).toContain("BID_DEADLINE_NOT_EVALUATED");
    expect(screen.getByText("内部投标底稿")).toBeVisible();
    expect(screen.getByText(/未绑定完整招标文件版本/u)).toBeVisible();
    const firstFinding = snapshot.findings[0];
    expect(firstFinding).toBeDefined();
    expect(screen.getAllByText(firstFinding?.code ?? "")[0]).toBeVisible();
    expect(screen.getAllByText("必填内容仍为占位信息，请补充真实内容。")[0]).toBeVisible();
    expect(screen.queryAllByText(firstFinding?.message ?? "", { exact: true })).toHaveLength(0);
    expect(screen.getAllByText(firstFinding?.impact ?? "")[0]).toBeVisible();
  });

  it("keeps submission export disabled while internal output remains reachable", () => {
    const snapshot = snapshotFor("bid.government.services.v1");
    render(<ExportPanel snapshot={snapshot} attachments={[]} />);

    expect(screen.getByRole("button", { name: "下载内部底稿 PDF" })).toBeEnabled();
    const submission = screen.getByRole("button", { name: "下载提交版 PDF" });
    expect(submission).toBeDisabled();
    expect(submission).toHaveAttribute("aria-describedby");
    expect(screen.getByText(/完成来源绑定与全部阻断项复核后才可导出/u)).toBeVisible();
  });
});
