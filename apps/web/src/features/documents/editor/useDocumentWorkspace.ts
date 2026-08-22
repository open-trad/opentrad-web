import { v2 } from "@opentrad/document-core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportedProjectV2 } from "../project/projectV2Files";
import type { StoredAttachmentV2 } from "../storage/attachmentValidation";
import {
  type AttachmentChange,
  createDocumentRepository,
  DocumentRepositoryError,
  type DocumentRepositoryV2,
  documentStorageKey,
  type StoredDocumentV2,
} from "../storage/documentRepository";
import type { AttachmentTransactionResult } from "./attachments";
import { assertImportedProjectConfirmed } from "./attachments";

type Registration = ReturnType<typeof v2.V2_TEMPLATE_REGISTRY.get>;
export type DocumentAutosaveStatus = "idle" | "saving" | "saved" | "error" | "conflict" | "invalid";

export interface DocumentValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface DocumentRevisionSnapshot {
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly draft: unknown;
  readonly model: v2.DocumentModelV2;
  readonly findings: readonly v2.RiskFindingV2[];
}

export interface DocumentWorkspaceOptions {
  readonly registration: Registration;
  readonly repository?: DocumentRepositoryV2;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly autosaveDelayMs?: number;
  readonly trustedAsOf?: string;
}

interface SaveJob {
  readonly envelope: v2.ProjectEnvelopeV2;
  readonly attachmentChanges: readonly AttachmentChange[];
  readonly generation: number;
  ready: boolean;
}

const defaultNow = () => new Date().toISOString();
const defaultId = () =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function validationIssues(error: unknown): readonly DocumentValidationIssue[] {
  if (error === null || typeof error !== "object") {
    return [{ path: "", message: "表单内容无效" }];
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(error, "issues");
  if (!descriptor || !("value" in descriptor) || !Array.isArray(descriptor.value)) {
    return [{ path: "", message: error instanceof Error ? error.message : "表单内容无效" }];
  }
  return descriptor.value.flatMap((issue): DocumentValidationIssue[] => {
    if (issue === null || typeof issue !== "object") return [];
    const path = Reflect.getOwnPropertyDescriptor(issue, "path")?.value;
    const message = Reflect.getOwnPropertyDescriptor(issue, "message")?.value;
    return Array.isArray(path) && typeof message === "string"
      ? [{ path: path.map(String).join("."), message }]
      : [];
  });
}

function createEnvelope(registration: Registration, id: string, now: string): v2.ProjectEnvelopeV2 {
  return v2.ProjectEnvelopeV2Schema.parse({
    formatVersion: "2.0.0",
    template: {
      id: registration.definition.id,
      version: registration.definition.version,
      basisDate: registration.definition.basisDate,
    },
    draft: registration.createDraft({ id, now }),
    presentation: {
      layoutStyleId: registration.definition.defaultLayout,
      languageView: registration.definition.defaultLanguage,
    },
    attachmentManifest: [],
  });
}

function snapshot(
  registration: Registration,
  envelope: v2.ProjectEnvelopeV2,
  trustedAsOf?: string,
  parsedDraft?: unknown,
): DocumentRevisionSnapshot {
  const draft = parsedDraft ?? registration.parseDraft(envelope.draft);
  const context = trustedAsOf === undefined ? undefined : { asOf: trustedAsOf };
  return {
    envelope,
    draft,
    model: registration.compile(draft as never, context) as v2.DocumentModelV2,
    findings: registration.preflight(draft as never, context),
  };
}

function sameTemplate(stored: StoredDocumentV2, registration: Registration): boolean {
  return (
    stored.templateId === registration.definition.id &&
    stored.templateVersion === registration.definition.version
  );
}

function mergeAttachmentChanges(
  current: readonly AttachmentChange[],
  incoming: readonly AttachmentChange[],
): readonly AttachmentChange[] {
  const merged = new Map(current.map((change) => [change.attachmentId, change]));
  for (const change of incoming) merged.set(change.attachmentId, change);
  return [...merged.values()];
}

export function useDocumentWorkspace(options: DocumentWorkspaceOptions) {
  const registrationRef = useRef(options.registration);
  const nowRef = useRef(options.now ?? defaultNow);
  const createIdRef = useRef(options.createId ?? defaultId);
  const delayRef = useRef(options.autosaveDelayMs ?? 400);
  const trustedAsOfRef = useRef(options.trustedAsOf);
  const repositoryRef = useRef<DocumentRepositoryV2 | null>(null);
  if (!repositoryRef.current) {
    repositoryRef.current =
      options.repository ?? createDocumentRepository({ registry: v2.V2_TEMPLATE_REGISTRY });
  }
  const ownsRepositoryRef = useRef(!options.repository);
  const repository = repositoryRef.current;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<v2.ProjectEnvelopeV2 | null>(null);
  const [rawDraft, setRawDraft] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [revisionSnapshot, setRevisionSnapshot] = useState<DocumentRevisionSnapshot | null>(null);
  const [validationIssueList, setValidationIssueList] = useState<
    readonly DocumentValidationIssue[]
  >([]);
  const [autosaveStatus, setAutosaveStatus] = useState<DocumentAutosaveStatus>("idle");
  const [attachmentRecords, setAttachmentRecords] = useState<readonly StoredAttachmentV2[]>([]);
  const [hydrationKey, setHydrationKey] = useState(0);

  const mountedRef = useRef(false);
  const envelopeRef = useRef<v2.ProjectEnvelopeV2 | null>(null);
  const revisionRef = useRef(0);
  const pendingRef = useRef<SaveJob | null>(null);
  const attachmentChangesRef = useRef<readonly AttachmentChange[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainingRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);
  const invalidRef = useRef(false);
  const initializationRef = useRef<Promise<StoredDocumentV2> | null>(null);
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setStatusIfMounted = useCallback((status: DocumentAutosaveStatus) => {
    if (mountedRef.current) setAutosaveStatus(status);
  }, []);

  const drain = useCallback(async () => {
    while (pendingRef.current?.ready && !conflictRef.current) {
      const job = pendingRef.current;
      pendingRef.current = null;
      if (!invalidRef.current) setStatusIfMounted("saving");
      try {
        const stored = await repository.commit({
          envelope: job.envelope,
          savedAt: nowRef.current(),
          makeCurrent: true,
          expectedRevision: revisionRef.current,
          attachmentChanges: job.attachmentChanges,
        });
        revisionRef.current = stored.revision;
        if (mountedRef.current) {
          setRevision(stored.revision);
          if (job.generation === generationRef.current) setEnvelope(stored.envelope);
        }
        if (job.generation === generationRef.current) envelopeRef.current = stored.envelope;
        if (job.generation === generationRef.current && !pendingRef.current) {
          attachmentChangesRef.current = [];
          if (!invalidRef.current) setStatusIfMounted("saved");
        }
      } catch (error) {
        if (error instanceof DocumentRepositoryError && error.code === "DOCUMENT_CONFLICT") {
          conflictRef.current = true;
          setStatusIfMounted("conflict");
        } else if (job.generation === generationRef.current && !invalidRef.current) {
          setStatusIfMounted("error");
        }
      }
    }
  }, [repository, setStatusIfMounted]);

  const startDrain = useCallback((): Promise<void> => {
    if (!drainingRef.current) {
      drainingRef.current = drain().finally(() => {
        drainingRef.current = null;
        if (pendingRef.current?.ready && !conflictRef.current) void startDrain();
      });
    }
    return drainingRef.current;
  }, [drain]);

  const schedule = useCallback(
    (nextEnvelope: v2.ProjectEnvelopeV2) => {
      if (conflictRef.current) return;
      generationRef.current += 1;
      pendingRef.current = {
        envelope: nextEnvelope,
        attachmentChanges: attachmentChangesRef.current,
        generation: generationRef.current,
        ready: false,
      };
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current) {
          pendingRef.current.ready = true;
          void startDrain();
        }
      }, delayRef.current);
    },
    [clearTimer, startDrain],
  );

  const flush = useCallback(async () => {
    clearTimer();
    if (pendingRef.current && !conflictRef.current) {
      pendingRef.current.ready = true;
      void startDrain();
    }
    while (drainingRef.current) {
      const active = drainingRef.current;
      await active;
      if (drainingRef.current === active) break;
    }
  }, [clearTimer, startDrain]);

  const hydrate = useCallback((stored: StoredDocumentV2) => {
    generationRef.current += 1;
    const validated = v2.ProjectEnvelopeV2Schema.parse(stored.envelope);
    const nextSnapshot = snapshot(registrationRef.current, validated, trustedAsOfRef.current);
    revisionRef.current = stored.revision;
    envelopeRef.current = validated;
    attachmentChangesRef.current = [];
    conflictRef.current = false;
    invalidRef.current = false;
    setEnvelope(validated);
    setRawDraft(validated.draft);
    setRevision(stored.revision);
    setRevisionSnapshot(nextSnapshot);
    setValidationIssueList([]);
    setAttachmentRecords([]);
    setHydrationKey((current) => current + 1);
    setAutosaveStatus("idle");
    setLoadError(null);
  }, []);

  const markInvalid = useCallback(
    (issues: readonly DocumentValidationIssue[]) => {
      generationRef.current += 1;
      clearTimer();
      pendingRef.current = null;
      invalidRef.current = true;
      setValidationIssueList(issues);
      if (!conflictRef.current) setAutosaveStatus("invalid");
    },
    [clearTimer],
  );

  const initialize = useCallback(async (): Promise<StoredDocumentV2> => {
    const current = await repository.getCurrent();
    if (current && sameTemplate(current, registrationRef.current)) return current;
    const documents = await repository.list();
    const restored = documents.find((document) => sameTemplate(document, registrationRef.current));
    if (restored) return restored;
    const created = createEnvelope(
      registrationRef.current,
      createIdRef.current(),
      nowRef.current(),
    );
    return repository.commit({
      envelope: created,
      savedAt: nowRef.current(),
      makeCurrent: true,
      expectedRevision: 0,
      attachmentChanges: [],
      failIfExists: true,
    });
  }, [repository]);

  useEffect(() => {
    mountedRef.current = true;
    if (!initializationRef.current) initializationRef.current = initialize();
    void initializationRef.current
      .then((stored) => {
        if (!mountedRef.current) return;
        hydrate(stored);
        setLoading(false);
        void repository
          .listAttachments(stored.key)
          .then((records) => {
            if (mountedRef.current) setAttachmentRecords(records);
          })
          .catch(() => {
            if (mountedRef.current) setLoadError("本机附件读取失败，请重新载入后重试");
          });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setLoadError("无法读取本机文书，请检查浏览器存储权限后重试");
        setLoading(false);
      });
    const handlePageHide = () => void flush();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", handlePageHide);
      void flush().finally(() => {
        if (!mountedRef.current && ownsRepositoryRef.current) repository.close();
      });
    };
  }, [flush, hydrate, initialize, repository]);

  const acceptValidEnvelope = useCallback(
    (candidate: v2.ProjectEnvelopeV2, parsedDraft?: unknown, clearFormInvalidity = true) => {
      const nextSnapshot = snapshot(
        registrationRef.current,
        candidate,
        trustedAsOfRef.current,
        parsedDraft,
      );
      envelopeRef.current = candidate;
      setEnvelope(candidate);
      if (clearFormInvalidity) setRawDraft(candidate.draft);
      setRevisionSnapshot(nextSnapshot);
      if (clearFormInvalidity) {
        invalidRef.current = false;
        setValidationIssueList([]);
        if (!conflictRef.current) setAutosaveStatus("idle");
      }
      schedule(candidate);
    },
    [schedule],
  );

  const updateDraft = useCallback(
    (candidate: unknown) => {
      setRawDraft(candidate);
      const current = envelopeRef.current;
      if (!current) return false;
      try {
        const parsedDraft = registrationRef.current.parseDraft(candidate) as v2.ProjectDraftV2;
        const nextEnvelope = v2.ProjectEnvelopeV2Schema.parse({ ...current, draft: parsedDraft });
        acceptValidEnvelope(nextEnvelope, parsedDraft);
        return true;
      } catch (error) {
        markInvalid(validationIssues(error));
        return false;
      }
    },
    [acceptValidEnvelope, markInvalid],
  );

  const acceptParsedDraft = useCallback(
    (parsedDraft: unknown) => {
      setRawDraft(parsedDraft);
      const current = envelopeRef.current;
      if (!current) return false;
      try {
        const nextEnvelope = v2.ProjectEnvelopeV2Schema.parse({ ...current, draft: parsedDraft });
        acceptValidEnvelope(nextEnvelope, parsedDraft);
        return true;
      } catch (error) {
        markInvalid(validationIssues(error));
        return false;
      }
    },
    [acceptValidEnvelope, markInvalid],
  );

  const updatePresentation = useCallback(
    (presentation: v2.ProjectEnvelopeV2["presentation"]) => {
      const current = envelopeRef.current;
      if (!current) return false;
      try {
        acceptValidEnvelope(
          v2.ProjectEnvelopeV2Schema.parse({ ...current, presentation }),
          undefined,
          false,
        );
        return true;
      } catch (error) {
        setValidationIssueList(validationIssues(error));
        return false;
      }
    },
    [acceptValidEnvelope],
  );

  const reportValidationIssues = useCallback(
    (issues: readonly DocumentValidationIssue[]) => {
      if (issues.length > 0) markInvalid(issues);
      else if (!invalidRef.current) setValidationIssueList([]);
    },
    [markInvalid],
  );

  const applyAttachmentTransaction = useCallback(
    (transaction: AttachmentTransactionResult) => {
      attachmentChangesRef.current = mergeAttachmentChanges(
        attachmentChangesRef.current,
        transaction.attachmentChanges,
      );
      setAttachmentRecords((current) => {
        const changedIds = new Set(
          transaction.attachmentChanges.map((change) => change.attachmentId),
        );
        const retained = current.filter((record) => !changedIds.has(record.attachmentId));
        return transaction.preparedRecord ? [...retained, transaction.preparedRecord] : retained;
      });
      acceptValidEnvelope(transaction.envelope, transaction.parsedDraft, false);
    },
    [acceptValidEnvelope],
  );

  const reload = useCallback(async () => {
    clearTimer();
    pendingRef.current = null;
    const current = envelopeRef.current;
    if (!current) return false;
    const stored = await repository.get(documentStorageKey(current));
    if (!stored || !sameTemplate(stored, registrationRef.current)) return false;
    hydrate(stored);
    setAttachmentRecords(await repository.listAttachments(stored.key));
    return true;
  }, [clearTimer, hydrate, repository]);

  const importConfirmedProject = useCallback(
    async (imported: ImportedProjectV2, userConfirmed: boolean) => {
      assertImportedProjectConfirmed(imported, userConfirmed);
      if (
        imported.envelope.template.id !== registrationRef.current.definition.id ||
        imported.envelope.template.version !== registrationRef.current.definition.version
      ) {
        throw new Error("项目包模板或版本与当前编辑器不一致");
      }
      clearTimer();
      pendingRef.current = null;
      generationRef.current += 1;
      attachmentChangesRef.current = [];
      if (drainingRef.current) await drainingRef.current;
      conflictRef.current = false;
      setStatusIfMounted("saving");
      try {
        const key = documentStorageKey(imported.envelope);
        const [previous, previousAttachments] = await Promise.all([
          repository.get(key),
          repository.listAttachments(key),
        ]);
        const incomingIds = new Set(imported.attachments.map((attachment) => attachment.id));
        const removals: AttachmentChange[] = previousAttachments
          .filter((attachment) => !incomingIds.has(attachment.attachmentId))
          .map((attachment) => ({ type: "remove", attachmentId: attachment.attachmentId }));
        const puts: AttachmentChange[] = imported.attachments.map((attachment) => ({
          type: "put",
          attachmentId: attachment.id,
          blob: new Blob([attachment.bytes.slice().buffer], { type: attachment.mediaType }),
          pageCountConfirmed: attachment.mediaType === "application/pdf" ? true : undefined,
        }));
        const stored = await repository.commit({
          envelope: imported.envelope,
          savedAt: nowRef.current(),
          makeCurrent: true,
          expectedRevision: previous?.revision ?? 0,
          attachmentChanges: [...removals, ...puts],
        });
        hydrate(stored);
        setAttachmentRecords(await repository.listAttachments(stored.key));
        setStatusIfMounted("saved");
        return stored;
      } catch (error) {
        if (error instanceof DocumentRepositoryError && error.code === "DOCUMENT_CONFLICT") {
          conflictRef.current = true;
          setStatusIfMounted("conflict");
        } else {
          setStatusIfMounted("error");
        }
        throw error;
      }
    },
    [clearTimer, hydrate, repository, setStatusIfMounted],
  );

  const statusMessage =
    autosaveStatus === "saving"
      ? "正在保存"
      : autosaveStatus === "saved"
        ? "已保存到本机"
        : autosaveStatus === "conflict"
          ? "文书已在其他页面更新，请重新载入"
          : autosaveStatus === "error"
            ? "保存失败，请检查本机存储后重试"
            : autosaveStatus === "invalid"
              ? "请修正表单错误；预览仍显示上一次有效内容"
              : "所有文书内容仅保存在当前设备";

  return {
    loading,
    loadError,
    envelope,
    rawDraft,
    revision,
    attachmentRecords,
    hydrationKey,
    snapshot: revisionSnapshot,
    validationIssues: validationIssueList,
    autosaveStatus,
    statusMessage,
    updateDraft,
    acceptParsedDraft,
    updatePresentation,
    reportValidationIssues,
    applyAttachmentTransaction,
    importConfirmedProject,
    reload,
    flush,
  };
}
