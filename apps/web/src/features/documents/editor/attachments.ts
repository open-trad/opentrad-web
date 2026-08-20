import { type TemplateFieldManifestEntryV1, v2 } from "@opentrad/document-core";
import {
  type AttachmentMediaType,
  prepareAttachmentPut,
  type StoredAttachmentV2,
  validateAttachmentInventory,
} from "../storage/attachmentValidation";
import { type AttachmentChange, documentStorageKey } from "../storage/documentRepository";
import { deleteDraftField, getDraftField, setDraftField } from "./fieldPaths";

type AttachmentField = Extract<
  TemplateFieldManifestEntryV1 | v2.TemplateRepeatableItemFieldV1,
  { control: "attachment" }
>;
type Registration = ReturnType<typeof v2.V2_TEMPLATE_REGISTRY.get>;

export interface AttachmentTransactionResult {
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly parsedDraft: v2.ProjectDraftV2;
  readonly attachmentChanges: readonly AttachmentChange[];
  readonly preparedRecord?: StoredAttachmentV2;
}

interface AttachmentAdditionInput {
  readonly registration: Registration;
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly field: AttachmentField;
  readonly path: string;
  readonly attachmentId: string;
  readonly displayName: string;
  readonly blob: Blob;
  readonly pageCount: number;
  readonly pageCountConfirmed?: boolean;
  readonly documentKind: "quotation" | "contract" | "bid";
  readonly savedAt: string;
  readonly existingRecords: readonly StoredAttachmentV2[];
}

interface AttachmentRemovalInput {
  readonly registration: Registration;
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly field: AttachmentField;
  readonly path: string;
  readonly attachmentId: string;
}

const ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const ALLOWED_MEDIA_TYPES = new Set<AttachmentMediaType>([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

function fail(message: string): never {
  throw new Error(message);
}

function mediaTypeOf(blob: Blob): AttachmentMediaType {
  if (!ALLOWED_MEDIA_TYPES.has(blob.type as AttachmentMediaType)) {
    fail("仅支持 PDF、PNG 或 JPEG 附件");
  }
  return blob.type as AttachmentMediaType;
}

function portableDescriptor(descriptor: v2.AttachmentRefV1): v2.AttachmentRefV1 {
  const { localBlobKey: _localBlobKey, ...portable } = descriptor;
  return portable;
}

function descriptorsFromDraft(draft: v2.ProjectDraftV2): readonly v2.AttachmentRefV1[] {
  const descriptors = getDraftField(draft, "attachments");
  if (!Array.isArray(descriptors)) fail("模板草稿缺少附件清单");
  return descriptors as readonly v2.AttachmentRefV1[];
}

function assertPathMatchesField(field: AttachmentField, path: string): void {
  if (path !== field.path && !path.endsWith(`.${field.path}`)) {
    fail("附件字段路径与模板声明不一致");
  }
}

function setAttachmentReference(
  draft: v2.ProjectDraftV2,
  field: AttachmentField,
  path: string,
  attachmentId: string,
): v2.ProjectDraftV2 {
  const current = getDraftField(draft, path);
  if (field.cardinality === "multiple") {
    const ids = Array.isArray(current)
      ? current.filter((value): value is string => typeof value === "string")
      : [];
    if (ids.length >= field.maxItems) fail(`${field.label}最多 ${field.maxItems} 个附件`);
    if (ids.includes(attachmentId)) fail("附件已在字段中");
    return setDraftField(draft, path, [...ids, attachmentId]) as v2.ProjectDraftV2;
  }
  if (typeof current === "string" && current.length > 0) {
    fail(`${field.label}最多 1 个附件`);
  }
  return setDraftField(draft, path, attachmentId) as v2.ProjectDraftV2;
}

function removeAttachmentReference(
  draft: v2.ProjectDraftV2,
  field: AttachmentField,
  path: string,
  attachmentId: string,
): v2.ProjectDraftV2 {
  const current = getDraftField(draft, path);
  if (field.cardinality === "multiple") {
    if (!Array.isArray(current) || !current.includes(attachmentId)) fail("附件字段未引用该附件");
    return setDraftField(
      draft,
      path,
      current.filter((value) => value !== attachmentId),
    ) as v2.ProjectDraftV2;
  }
  if (current !== attachmentId) fail("附件字段未引用该附件");
  return (
    field.required ? setDraftField(draft, path, "") : deleteDraftField(draft, path)
  ) as v2.ProjectDraftV2;
}

function parsedEnvelope(
  envelope: v2.ProjectEnvelopeV2,
  registration: Registration,
  draftCandidate: v2.ProjectDraftV2,
  attachmentManifest: readonly v2.AttachmentRefV1[],
): Pick<AttachmentTransactionResult, "envelope" | "parsedDraft"> {
  const parsedDraft = registration.parseDraft(draftCandidate) as v2.ProjectDraftV2;
  return {
    parsedDraft,
    envelope: v2.ProjectEnvelopeV2Schema.parse({
      ...envelope,
      draft: parsedDraft,
      attachmentManifest,
    }),
  };
}

export async function prepareAttachmentAddition(
  input: AttachmentAdditionInput,
): Promise<AttachmentTransactionResult> {
  assertPathMatchesField(input.field, input.path);
  if (!ATTACHMENT_ID.test(input.attachmentId)) fail("附件标识必须是安全的本地路径片段");
  if (input.displayName.trim().length < 1 || input.displayName.length > 500) {
    fail("附件名称无效");
  }
  const mediaType = mediaTypeOf(input.blob);
  if (!input.field.allowedMediaTypes.includes(mediaType)) fail("模板不接受此附件类型");
  if (!Number.isSafeInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > 10_000) {
    fail("附件页数无效");
  }
  if (mediaType === "application/pdf" && input.pageCountConfirmed !== true) {
    fail("请确认 PDF 页数；OpenTrad 不会自动解析页数");
  }
  if (mediaType !== "application/pdf" && input.pageCount !== 1) {
    fail("图片附件页数必须为 1");
  }

  const existingDraftDescriptors = descriptorsFromDraft(input.envelope.draft);
  if (
    existingDraftDescriptors.some((descriptor) => descriptor.id === input.attachmentId) ||
    input.envelope.attachmentManifest.some((descriptor) => descriptor.id === input.attachmentId)
  ) {
    fail("附件标识重复");
  }

  const documentKey = documentStorageKey(input.envelope);
  const localDescriptor: v2.AttachmentRefV1 = {
    id: input.attachmentId,
    category: input.field.category,
    displayName: input.displayName,
    mediaType,
    pageCount: input.pageCount,
    required: input.field.required,
    localBlobKey: `${documentKey}#${input.attachmentId}`,
    status: "attached",
    includedInSubmission: input.field.includeInSubmissionDefault,
  };
  const portable = portableDescriptor(localDescriptor);
  let draftCandidate = setAttachmentReference(
    input.envelope.draft,
    input.field,
    input.path,
    input.attachmentId,
  );
  draftCandidate = setDraftField(draftCandidate, input.field.descriptorPath, [
    ...existingDraftDescriptors,
    portable,
  ]) as v2.ProjectDraftV2;
  const manifest = [...input.envelope.attachmentManifest, localDescriptor];
  const parsed = parsedEnvelope(input.envelope, input.registration, draftCandidate, manifest);
  const preparedRecord = await prepareAttachmentPut({
    documentKey,
    descriptor: localDescriptor,
    blob: input.blob,
    pageCountConfirmed: input.pageCountConfirmed,
    savedAt: input.savedAt,
  });
  await validateAttachmentInventory({
    documentKey,
    documentKind: input.documentKind,
    descriptors: parsed.envelope.attachmentManifest,
    records: [...input.existingRecords, preparedRecord],
  });

  return {
    ...parsed,
    preparedRecord,
    attachmentChanges: [
      {
        type: "put",
        attachmentId: input.attachmentId,
        blob: input.blob,
        pageCountConfirmed: mediaType === "application/pdf" ? true : undefined,
      },
    ],
  };
}

export function prepareAttachmentRemoval(
  input: AttachmentRemovalInput,
): AttachmentTransactionResult {
  assertPathMatchesField(input.field, input.path);
  const draftDescriptors = descriptorsFromDraft(input.envelope.draft);
  if (!draftDescriptors.some((descriptor) => descriptor.id === input.attachmentId)) {
    fail("附件清单中不存在该附件");
  }
  let draftCandidate = removeAttachmentReference(
    input.envelope.draft,
    input.field,
    input.path,
    input.attachmentId,
  );
  draftCandidate = setDraftField(
    draftCandidate,
    input.field.descriptorPath,
    draftDescriptors.filter((descriptor) => descriptor.id !== input.attachmentId),
  ) as v2.ProjectDraftV2;
  const manifest = input.envelope.attachmentManifest.filter(
    (descriptor) => descriptor.id !== input.attachmentId,
  );
  if (manifest.length === input.envelope.attachmentManifest.length) {
    fail("本机附件清单中不存在该附件");
  }
  return {
    ...parsedEnvelope(input.envelope, input.registration, draftCandidate, manifest),
    attachmentChanges: [{ type: "remove", attachmentId: input.attachmentId }],
  };
}

export function assertImportedProjectConfirmed(
  imported: { readonly requiresUserConfirmation: boolean },
  userConfirmed: boolean,
): void {
  if (imported.requiresUserConfirmation && !userConfirmed) {
    fail("导入项目需要用户明确确认后才能保存到本机");
  }
}
