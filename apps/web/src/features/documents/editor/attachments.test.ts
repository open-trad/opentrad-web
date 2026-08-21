import { v2 } from "@opentrad/document-core";
import { describe, expect, it } from "vitest";
import type { StoredAttachmentV2 } from "../storage/attachmentValidation";
import {
  assertImportedProjectConfirmed,
  prepareAttachmentAddition,
  prepareAttachmentRemoval,
} from "./attachments";
import { getDraftField, setDraftField } from "./fieldPaths";

type AttachmentField = Extract<
  v2.TemplateFieldManifestEntryV1 | v2.TemplateRepeatableItemFieldV1,
  { control: "attachment" }
>;

const NOW = "2026-08-20T08:00:00.000Z";

function registration(templateId: string) {
  return v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
}

function attachmentField(templateId: string, path: string): AttachmentField {
  const field = registration(templateId).definition.fieldManifest.find(
    (entry) => entry.path === path,
  );
  if (!field || field.control !== "attachment") throw new Error(`missing ${path}`);
  return field;
}

function envelopeFor(templateId: string, id = "document-test"): v2.ProjectEnvelopeV2 {
  const current = registration(templateId);
  return {
    formatVersion: "2.0.0",
    template: {
      id: current.definition.id,
      version: current.definition.version,
      basisDate: current.definition.basisDate,
    },
    draft: current.createDraft({ id, now: NOW }) as v2.ProjectDraftV2,
    presentation: {
      layoutStyleId: current.definition.defaultLayout,
      languageView: current.definition.defaultLanguage,
    },
    attachmentManifest: [],
  };
}

function pdfBlob(size = 12): Blob {
  const prefix = new TextEncoder().encode("%PDF-1.7\n");
  return new Blob([prefix, new Uint8Array(Math.max(0, size - prefix.byteLength))], {
    type: "application/pdf",
  });
}

function pngBlob(): Blob {
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: "image/png",
  });
}

describe("editor attachment transactions", () => {
  it("maps a multiple submission file across the draft field, portable descriptors, local manifest, and repo change", async () => {
    const templateId = "contract.oem.processing.v1";
    const current = registration(templateId);
    const envelope = envelopeFor(templateId);
    const blob = pdfBlob();

    const result = await prepareAttachmentAddition({
      registration: current,
      envelope,
      field: attachmentField(templateId, "technical.drawingAttachmentIds"),
      path: "technical.drawingAttachmentIds",
      attachmentId: "drawing-1",
      displayName: "工艺图纸.pdf",
      blob,
      pageCount: 2,
      pageCountConfirmed: true,
      documentKind: "contract",
      savedAt: NOW,
      existingRecords: [],
    });

    expect(result.envelope).not.toBe(envelope);
    expect((envelope.draft as Record<string, unknown>).attachments).toEqual([]);
    expect(getDraftField(result.envelope.draft, "technical.drawingAttachmentIds")).toEqual([
      "drawing-1",
    ]);
    expect(getDraftField(result.envelope.draft, "attachments")).toEqual([
      {
        id: "drawing-1",
        category: "technical",
        displayName: "工艺图纸.pdf",
        mediaType: "application/pdf",
        pageCount: 2,
        required: true,
        status: "attached",
        includedInSubmission: true,
      },
    ]);
    expect(result.envelope.attachmentManifest[0]).toMatchObject({
      id: "drawing-1",
      localBlobKey: "contract.oem.processing.v1@1.0.0:document-test#drawing-1",
    });
    expect(result.attachmentChanges).toEqual([
      { type: "put", attachmentId: "drawing-1", blob, pageCountConfirmed: true },
    ]);
  });

  it("keeps solicitation source files local and out of submission output", async () => {
    const templateId = "bid.government.services.v1";
    const envelope = envelopeFor(templateId);
    const result = await prepareAttachmentAddition({
      registration: registration(templateId),
      envelope,
      field: attachmentField(templateId, "source.versionEvidence.mainSolicitationAttachmentId"),
      path: "source.versionEvidence.mainSolicitationAttachmentId",
      attachmentId: "solicitation-main",
      displayName: "采购文件.pdf",
      blob: pdfBlob(),
      pageCount: 10,
      pageCountConfirmed: true,
      documentKind: "bid",
      savedAt: NOW,
      existingRecords: [],
    });

    expect(
      getDraftField(result.envelope.draft, "source.versionEvidence.mainSolicitationAttachmentId"),
    ).toBe("solicitation-main");
    expect(getDraftField(result.envelope.draft, "attachments.0")).toMatchObject({
      id: "solicitation-main",
      category: "other",
      includedInSubmission: false,
    });
    expect(result.envelope.attachmentManifest[0]?.includedInSubmission).toBe(false);
  });

  it("removes the field reference, both descriptors, and Blob in one immutable candidate", async () => {
    const templateId = "contract.oem.processing.v1";
    const current = registration(templateId);
    const added = await prepareAttachmentAddition({
      registration: current,
      envelope: envelopeFor(templateId),
      field: attachmentField(templateId, "technical.drawingAttachmentIds"),
      path: "technical.drawingAttachmentIds",
      attachmentId: "drawing-1",
      displayName: "工艺图纸.pdf",
      blob: pdfBlob(),
      pageCount: 2,
      pageCountConfirmed: true,
      documentKind: "contract",
      savedAt: NOW,
      existingRecords: [],
    });

    const removed = prepareAttachmentRemoval({
      registration: current,
      envelope: added.envelope,
      field: attachmentField(templateId, "technical.drawingAttachmentIds"),
      path: "technical.drawingAttachmentIds",
      attachmentId: "drawing-1",
    });

    expect(getDraftField(removed.envelope.draft, "technical.drawingAttachmentIds")).toEqual([]);
    expect(getDraftField(removed.envelope.draft, "attachments")).toEqual([]);
    expect(removed.envelope.attachmentManifest).toEqual([]);
    expect(removed.attachmentChanges).toEqual([{ type: "remove", attachmentId: "drawing-1" }]);
    expect(added.envelope.attachmentManifest).toHaveLength(1);
  });

  it("removes a required scalar bid-source attachment back to its valid unbound state", async () => {
    const templateId = "bid.government.goods.v1";
    const current = registration(templateId);
    const field = attachmentField(
      templateId,
      "source.versionEvidence.mainSolicitationAttachmentId",
    );
    const added = await prepareAttachmentAddition({
      registration: current,
      envelope: envelopeFor(templateId),
      field,
      path: field.path,
      attachmentId: "source-main",
      displayName: "项目招标文件.png",
      blob: pngBlob(),
      pageCount: 1,
      documentKind: "bid",
      savedAt: NOW,
      existingRecords: [],
    });

    const removed = prepareAttachmentRemoval({
      registration: current,
      envelope: added.envelope,
      field,
      path: field.path,
      attachmentId: "source-main",
    });

    expect(
      getDraftField(removed.envelope.draft, "source.versionEvidence.mainSolicitationAttachmentId"),
    ).toBeUndefined();
    expect(getDraftField(removed.envelope.draft, "attachments")).toEqual([]);
    expect(removed.envelope.attachmentManifest).toEqual([]);
  });

  it("rejects unsupported media, unconfirmed PDF pages, item overflow, and unsafe ids before a commit", async () => {
    const templateId = "contract.supply.framework.v1";
    const base = {
      registration: registration(templateId),
      envelope: envelopeFor(templateId),
      field: attachmentField(templateId, "orderTemplateAttachmentId"),
      path: "orderTemplateAttachmentId",
      attachmentId: "order-template",
      displayName: "订单模板.pdf",
      pageCount: 1,
      documentKind: "contract" as const,
      savedAt: NOW,
      existingRecords: [] as StoredAttachmentV2[],
    };

    await expect(
      prepareAttachmentAddition({ ...base, blob: new Blob(["text"], { type: "text/plain" }) }),
    ).rejects.toThrow("仅支持 PDF、PNG 或 JPEG");
    await expect(prepareAttachmentAddition({ ...base, blob: pdfBlob() })).rejects.toThrow(
      "请确认 PDF 页数",
    );
    await expect(
      prepareAttachmentAddition({ ...base, attachmentId: "../escape", blob: pdfBlob() }),
    ).rejects.toThrow("附件标识");

    const first = await prepareAttachmentAddition({
      ...base,
      blob: pngBlob(),
      pageCount: 1,
      attachmentId: "order-image",
      displayName: "订单模板.png",
    });
    await expect(
      prepareAttachmentAddition({
        ...base,
        envelope: first.envelope,
        blob: pngBlob(),
        pageCount: 1,
        attachmentId: "second-image",
      }),
    ).rejects.toThrow("最多 1 个");
  });

  it("enforces file budgets while allowing excluded bid source pages beyond 80", async () => {
    const templateId = "contract.oem.processing.v1";
    const base = {
      registration: registration(templateId),
      envelope: envelopeFor(templateId),
      field: attachmentField(templateId, "technical.drawingAttachmentIds"),
      path: "technical.drawingAttachmentIds",
      attachmentId: "drawing-limit",
      displayName: "limit.pdf",
      pageCount: 1,
      pageCountConfirmed: true,
      documentKind: "contract" as const,
      savedAt: NOW,
      existingRecords: [] as StoredAttachmentV2[],
    };
    await expect(
      prepareAttachmentAddition({ ...base, blob: pdfBlob(25 * 1024 * 1024 + 1) }),
    ).rejects.toThrow("25 MiB");

    const documentKey = `${templateId}@1.0.0:document-test`;
    const largeBlob = pdfBlob(25 * 1024 * 1024);
    const largeDescriptors = ["large-a", "large-b"].map(
      (id): v2.AttachmentRefV1 => ({
        id,
        category: "technical",
        displayName: `${id}.pdf`,
        mediaType: "application/pdf",
        pageCount: 1,
        required: true,
        localBlobKey: `${documentKey}#${id}`,
        status: "attached",
        includedInSubmission: true,
      }),
    );
    const largeRecords = largeDescriptors.map(
      (descriptor): StoredAttachmentV2 => ({
        localBlobKey: descriptor.localBlobKey as string,
        documentKey,
        attachmentId: descriptor.id,
        mediaType: descriptor.mediaType,
        byteLength: largeBlob.size,
        pageCount: 1,
        pageCountConfirmed: true,
        blob: largeBlob,
        savedAt: NOW,
      }),
    );
    const totalEnvelope = envelopeFor(templateId);
    const totalDraft = setDraftField(
      setDraftField(
        totalEnvelope.draft,
        "technical.drawingAttachmentIds",
        largeDescriptors.map((descriptor) => descriptor.id),
      ),
      "attachments",
      largeDescriptors.map(({ localBlobKey: _localBlobKey, ...descriptor }) => descriptor),
    ) as v2.ProjectDraftV2;
    await expect(
      prepareAttachmentAddition({
        ...base,
        envelope: {
          ...totalEnvelope,
          draft: totalDraft,
          attachmentManifest: largeDescriptors,
        },
        attachmentId: "over-total",
        blob: pdfBlob(),
        existingRecords: largeRecords,
      }),
    ).rejects.toThrow("50 MiB");

    const hundredIds = Array.from({ length: 100 }, (_, index) => `drawing-${index}`);
    const hundredDraft = setDraftField(
      setDraftField(totalEnvelope.draft, "technical.drawingAttachmentIds", hundredIds),
      "attachments",
      hundredIds.map((id) => ({
        id,
        category: "technical" as const,
        displayName: `${id}.png`,
        mediaType: "image/png" as const,
        pageCount: 1,
        required: true,
        status: "attached" as const,
        includedInSubmission: true,
      })),
    ) as v2.ProjectDraftV2;
    await expect(
      prepareAttachmentAddition({
        ...base,
        envelope: { ...totalEnvelope, draft: hundredDraft },
        attachmentId: "drawing-101",
        displayName: "drawing-101.png",
        blob: pngBlob(),
      }),
    ).rejects.toThrow("最多 100 个");

    const bidTemplate = "bid.government.services.v1";
    const descriptor: v2.AttachmentRefV1 = {
      id: "existing-source",
      category: "other",
      displayName: "existing.pdf",
      mediaType: "application/pdf",
      pageCount: 80,
      required: true,
      localBlobKey: `${bidTemplate}@1.0.0:document-test#existing-source`,
      status: "attached",
      includedInSubmission: false,
    };
    const existingBlob = pdfBlob();
    const existing: StoredAttachmentV2 = {
      localBlobKey: descriptor.localBlobKey as string,
      documentKey: `${bidTemplate}@1.0.0:document-test`,
      attachmentId: descriptor.id,
      mediaType: descriptor.mediaType,
      byteLength: existingBlob.size,
      pageCount: 80,
      pageCountConfirmed: true,
      blob: existingBlob,
      savedAt: NOW,
    };
    const bidEnvelope = envelopeFor(bidTemplate);
    const draft = {
      ...(bidEnvelope.draft as Record<string, unknown>),
      attachments: [
        {
          id: descriptor.id,
          category: descriptor.category,
          displayName: descriptor.displayName,
          mediaType: descriptor.mediaType,
          pageCount: descriptor.pageCount,
          required: descriptor.required,
          status: descriptor.status,
          includedInSubmission: descriptor.includedInSubmission,
        },
      ],
    } as unknown as v2.ProjectDraftV2;
    const sourceResult = await prepareAttachmentAddition({
      registration: registration(bidTemplate),
      envelope: { ...bidEnvelope, draft, attachmentManifest: [descriptor] },
      field: attachmentField(bidTemplate, "source.versionEvidence.mainSolicitationAttachmentId"),
      path: "source.versionEvidence.mainSolicitationAttachmentId",
      attachmentId: "another-source",
      displayName: "another.png",
      blob: pngBlob(),
      pageCount: 1,
      documentKind: "bid",
      savedAt: NOW,
      existingRecords: [existing],
    });
    expect(sourceResult.envelope.attachmentManifest).toContainEqual(
      expect.objectContaining({
        id: "another-source",
        includedInSubmission: false,
      }),
    );
  });

  it("never allows an imported ZIP result to enter storage without explicit confirmation", () => {
    expect(() => assertImportedProjectConfirmed({ requiresUserConfirmation: true }, false)).toThrow(
      "确认",
    );
    expect(() =>
      assertImportedProjectConfirmed({ requiresUserConfirmation: true }, true),
    ).not.toThrow();
  });
});
