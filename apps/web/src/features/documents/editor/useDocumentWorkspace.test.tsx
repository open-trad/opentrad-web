import { v2 } from "@opentrad/document-core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentRepositoryError,
  type DocumentRepositoryV2,
  documentStorageKey,
  type StoredDocumentV2,
} from "../storage/documentRepository";
import { prepareAttachmentAddition, prepareAttachmentRemoval } from "./attachments";
import { getDraftField, setDraftField } from "./fieldPaths";
import { SchemaForm } from "./SchemaForm";
import { useDocumentWorkspace } from "./useDocumentWorkspace";

const NOW = "2026-08-20T08:00:00.000Z";

function registration() {
  return v2.V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
}

function envelope(id = "workspace-test"): v2.ProjectEnvelopeV2 {
  const current = registration();
  return {
    formatVersion: "2.0.0",
    template: {
      id: current.definition.id,
      version: "1.0.0",
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

function stored(input: v2.ProjectEnvelopeV2, revision: number): StoredDocumentV2 {
  return {
    key: documentStorageKey(input),
    documentId: input.draft.id,
    templateId: input.template.id,
    templateVersion: input.template.version,
    templateKey: `${input.template.id}@${input.template.version}`,
    envelope: input,
    model: registration().compile(input.draft) as v2.DocumentModelV2,
    revision,
    savedAt: NOW,
  };
}

function fakeRepository(current: StoredDocumentV2 | null = null): DocumentRepositoryV2 {
  let active = current;
  return {
    commit: vi.fn(async (input) => {
      const next = stored(input.envelope as v2.ProjectEnvelopeV2, (active?.revision ?? 0) + 1);
      active = next;
      return next;
    }),
    get: vi.fn(async () => active),
    getCurrent: vi.fn(async () => active),
    list: vi.fn(async () => (active ? [active] : [])),
    listAttachments: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function IntegratedSchemaWorkspace({
  trackedRegistration,
  repository,
}: {
  readonly trackedRegistration: ReturnType<typeof registration>;
  readonly repository: DocumentRepositoryV2;
}) {
  const workspace = useDocumentWorkspace({
    registration: trackedRegistration,
    repository,
    createId: () => "unused",
    now: () => NOW,
    autosaveDelayMs: 60_000,
  });
  if (workspace.loading || !workspace.envelope) return <p>loading</p>;
  return (
    <SchemaForm
      registration={trackedRegistration}
      draft={workspace.envelope.draft}
      onDraftChange={workspace.acceptParsedDraft}
    />
  );
}

function ReloadableSchemaWorkspace({ repository }: { readonly repository: DocumentRepositoryV2 }) {
  const workspace = useDocumentWorkspace({
    registration: registration(),
    repository,
    createId: () => "unused",
    now: () => NOW,
  });
  if (workspace.loading || !workspace.envelope) return <p>loading</p>;
  return (
    <>
      <SchemaForm
        key={workspace.hydrationKey}
        registration={registration()}
        draft={workspace.envelope.draft}
        issues={workspace.validationIssues}
        onDraftChange={workspace.acceptParsedDraft}
        onValidationChange={workspace.reportValidationIssues}
      />
      <button type="button" onClick={() => void workspace.reload()}>
        重新载入测试文书
      </button>
      <output data-testid="workspace-snapshot">{JSON.stringify(workspace.snapshot?.draft)}</output>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("generic V2 document workspace", () => {
  it("parses a valid SchemaForm edit only once before compiling its revision", async () => {
    const base = registration();
    const tracked = {
      ...base,
      parseDraft: vi.fn(base.parseDraft),
      compile: vi.fn(base.compile),
      preflight: vi.fn(base.preflight),
    };
    render(
      <IntegratedSchemaWorkspace
        trackedRegistration={tracked}
        repository={fakeRepository(stored(envelope(), 1))}
      />,
    );
    const projectName = await screen.findByRole("textbox", { name: /项目名称.*必填/u });
    expect(tracked.parseDraft).toHaveBeenCalledTimes(1);

    fireEvent.change(projectName, { target: { value: "单次 UI 修订" } });

    expect(tracked.parseDraft).toHaveBeenCalledTimes(2);
    expect(tracked.compile).toHaveBeenCalledTimes(2);
    expect(tracked.preflight).toHaveBeenCalledTimes(2);
  });

  it("reuses the parsed draft carried by atomic attachment add and remove revisions", async () => {
    const base = v2.V2_TEMPLATE_REGISTRY.get("contract.oem.processing.v1", "1.0.0");
    const tracked = {
      ...base,
      parseDraft: vi.fn(base.parseDraft),
      compile: vi.fn(base.compile),
      preflight: vi.fn(base.preflight),
    };
    const initialEnvelope: v2.ProjectEnvelopeV2 = {
      formatVersion: "2.0.0",
      template: {
        id: base.definition.id,
        version: base.definition.version,
        basisDate: base.definition.basisDate,
      },
      draft: base.createDraft({ id: "attachment-count", now: NOW }) as v2.ProjectDraftV2,
      presentation: {
        layoutStyleId: base.definition.defaultLayout,
        languageView: base.definition.defaultLanguage,
      },
      attachmentManifest: [],
    };
    const attachmentField = base.definition.fieldManifest.find(
      (field) => field.path === "technical.drawingAttachmentIds",
    );
    if (!attachmentField || attachmentField.control !== "attachment") {
      throw new Error("missing attachment manifest field");
    }
    const repository = fakeRepository({
      ...stored(envelope(), 1),
      key: documentStorageKey(initialEnvelope),
      documentId: initialEnvelope.draft.id,
      templateId: initialEnvelope.template.id,
      templateVersion: initialEnvelope.template.version,
      templateKey: `${initialEnvelope.template.id}@${initialEnvelope.template.version}`,
      envelope: initialEnvelope,
      model: base.compile(initialEnvelope.draft as never) as v2.DocumentModelV2,
    });
    tracked.compile.mockClear();
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: tracked,
        repository,
        createId: () => "unused",
        now: () => NOW,
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const added = await prepareAttachmentAddition({
      registration: tracked,
      envelope: result.current.envelope as v2.ProjectEnvelopeV2,
      field: attachmentField,
      path: attachmentField.path,
      attachmentId: "drawing-count",
      displayName: "计数图纸.pdf",
      blob: new Blob([new TextEncoder().encode("%PDF-1.7\n%%EOF")], {
        type: "application/pdf",
      }),
      pageCount: 1,
      pageCountConfirmed: true,
      documentKind: "contract",
      savedAt: NOW,
      existingRecords: [],
    });
    act(() => result.current.applyAttachmentTransaction(added));
    const removed = prepareAttachmentRemoval({
      registration: tracked,
      envelope: result.current.envelope as v2.ProjectEnvelopeV2,
      field: attachmentField,
      path: attachmentField.path,
      attachmentId: "drawing-count",
    });
    act(() => result.current.applyAttachmentTransaction(removed));

    expect(tracked.parseDraft).toHaveBeenCalledTimes(3);
    expect(tracked.compile).toHaveBeenCalledTimes(3);
    expect(tracked.preflight).toHaveBeenCalledTimes(3);
  });

  it("parses, compiles, and preflights exactly once for each valid UI revision", async () => {
    const base = registration();
    const tracked = {
      ...base,
      parseDraft: vi.fn(base.parseDraft),
      compile: vi.fn(base.compile),
      preflight: vi.fn(base.preflight),
    };
    const repository = fakeRepository(stored(envelope(), 1));
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: tracked,
        repository,
        createId: () => "unused",
        now: () => NOW,
        autosaveDelayMs: 60_000,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tracked.parseDraft).toHaveBeenCalledTimes(1);
    expect(tracked.compile).toHaveBeenCalledTimes(1);
    expect(tracked.preflight).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "单次快照修订"),
      );
    });
    expect(tracked.parseDraft).toHaveBeenCalledTimes(2);
    expect(tracked.compile).toHaveBeenCalledTimes(2);
    expect(tracked.preflight).toHaveBeenCalledTimes(2);
  });

  it("creates and commits an exact 1.0.0 envelope when no matching document exists", async () => {
    const repository = fakeRepository();
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "created-exact",
        now: () => NOW,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.envelope?.template).toEqual({
      id: "quotation.service.project.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    });
    expect(repository.commit).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 0,
        failIfExists: true,
        makeCurrent: true,
        attachmentChanges: [],
      }),
    );
  });

  it("restores the matching current envelope and revision without resaving it", async () => {
    const existing = stored(envelope("restored"), 7);
    const repository = fakeRepository(existing);
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "unused",
        now: () => NOW,
      }),
    );

    await waitFor(() => expect(result.current.envelope?.draft.id).toBe("restored"));
    expect(result.current.revision).toBe(7);
    expect(repository.commit).not.toHaveBeenCalled();
  });

  it("debounces for 400 ms, serializes writes, and advances expectedRevision", async () => {
    vi.useFakeTimers();
    const existing = stored(envelope(), 3);
    const repository = fakeRepository(existing);
    const first = deferred<StoredDocumentV2>();
    vi.mocked(repository.commit)
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async (input) => stored(input.envelope as v2.ProjectEnvelopeV2, 5));
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "unused",
        now: () => NOW,
      }),
    );
    await act(async () => Promise.resolve());
    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "第一次编辑"),
      );
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "折叠后的编辑"),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(399));
    expect(repository.commit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(repository.commit).toHaveBeenCalledTimes(1);
    expect(repository.commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3 }),
    );

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "保存中的新编辑"),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(repository.commit).toHaveBeenCalledTimes(1);
    first.resolve(stored(result.current.envelope as v2.ProjectEnvelopeV2, 4));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.commit).toHaveBeenCalledTimes(2);
    expect(repository.commit).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 4 }),
    );
  });

  it("never hydrates an older commit over a newer pending edit", async () => {
    vi.useFakeTimers();
    const existing = stored(envelope(), 3);
    const repository = fakeRepository(existing);
    const first = deferred<StoredDocumentV2>();
    const second = deferred<StoredDocumentV2>();
    vi.mocked(repository.commit)
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "unused",
        now: () => NOW,
      }),
    );
    await act(async () => Promise.resolve());

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "编辑 A"),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    const envelopeA = vi.mocked(repository.commit).mock.calls[0]?.[0]
      .envelope as v2.ProjectEnvelopeV2;
    expect(getDraftField(envelopeA.draft, "project.projectName")).toBe("编辑 A");

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "编辑 B"),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(repository.commit).toHaveBeenCalledTimes(1);

    first.resolve(stored(envelopeA, 4));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDraftField(result.current.envelope?.draft, "project.projectName")).toBe("编辑 B");
    expect(repository.commit).toHaveBeenCalledTimes(2);
    const envelopeB = vi.mocked(repository.commit).mock.calls[1]?.[0]
      .envelope as v2.ProjectEnvelopeV2;
    expect(envelopeB).not.toBe(envelopeA);
    expect(getDraftField(envelopeB.draft, "project.projectName")).toBe("编辑 B");

    second.resolve(stored(envelopeB, 5));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDraftField(result.current.envelope?.draft, "project.projectName")).toBe("编辑 B");
    expect(result.current.revision).toBe(5);
  });

  it("stops retrying on a revision conflict and exposes an explicit reload action", async () => {
    vi.useFakeTimers();
    const existing = stored(envelope(), 2);
    const repository = fakeRepository(existing);
    vi.mocked(repository.commit).mockRejectedValueOnce(
      new DocumentRepositoryError("DOCUMENT_CONFLICT"),
    );
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "unused",
        now: () => NOW,
      }),
    );
    await act(async () => Promise.resolve());

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "冲突编辑"),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    await act(async () => Promise.resolve());
    expect(result.current.autosaveStatus).toBe("conflict");
    expect(result.current.statusMessage).toContain("重新载入");

    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "不得重试"),
      );
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(repository.commit).toHaveBeenCalledTimes(1);

    await act(async () => result.current.reload());
    expect(result.current.autosaveStatus).toBe("idle");
  });

  it("resets invalid SchemaForm raw state when conflict reload hydrates repository data", async () => {
    vi.useFakeTimers();
    const initial = stored(envelope(), 2);
    let repositoryVersion = initial;
    const repository: DocumentRepositoryV2 = {
      ...fakeRepository(initial),
      commit: vi.fn(async () => {
        throw new DocumentRepositoryError("DOCUMENT_CONFLICT");
      }),
      get: vi.fn(async () => repositoryVersion),
      getCurrent: vi.fn(async () => initial),
      list: vi.fn(async () => [initial]),
    };
    render(<ReloadableSchemaWorkspace repository={repository} />);
    await act(async () => Promise.resolve());
    const projectName = screen.getByRole("textbox", { name: /项目名称.*必填/u });
    const unitPrice = screen.getByRole("textbox", { name: /未税单价.*必填/u });

    fireEvent.change(projectName, { target: { value: "触发冲突的旧编辑" } });
    fireEvent.change(unitPrice, { target: { value: "" } });
    expect(unitPrice).toHaveValue("");
    await act(async () => vi.advanceTimersByTimeAsync(400));

    const nextDraft = registration().parseDraft(
      setDraftField(
        setDraftField(initial.envelope.draft, "project.projectName", "仓库新版本"),
        "serviceLines.0.unitPriceMinor",
        "2500",
      ),
    ) as v2.ProjectDraftV2;
    repositoryVersion = stored({ ...initial.envelope, draft: nextDraft }, 3);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新载入测试文书" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("textbox", { name: /项目名称.*必填/u })).toHaveValue("仓库新版本");
    expect(screen.getByRole("textbox", { name: /未税单价.*必填/u })).toHaveValue("25");
    expect(screen.getByTestId("workspace-snapshot")).toHaveTextContent("仓库新版本");
    expect(screen.getByTestId("workspace-snapshot")).toHaveTextContent("2500");
  });

  it("retains invalid raw input and the last-valid preview without scheduling a save", async () => {
    vi.useFakeTimers();
    const repository = fakeRepository(stored(envelope(), 1));
    const { result } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "unused",
        now: () => NOW,
      }),
    );
    await act(async () => Promise.resolve());
    const preview = result.current.snapshot;
    const invalid = setDraftField(result.current.envelope?.draft, "project.projectName", 42);

    act(() => result.current.updateDraft(invalid));
    expect(result.current.rawDraft).toBe(invalid);
    expect(result.current.snapshot).toBe(preview);
    expect(result.current.autosaveStatus).toBe("invalid");
    expect(result.current.validationIssues.length).toBeGreaterThan(0);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(repository.commit).not.toHaveBeenCalled();
  });

  it("flushes a pending valid revision before disposal", async () => {
    vi.useFakeTimers();
    const repository = fakeRepository(stored(envelope(), 1));
    const { result, unmount } = renderHook(() =>
      useDocumentWorkspace({
        registration: registration(),
        repository,
        createId: () => "unused",
        now: () => NOW,
        autosaveDelayMs: 60_000,
      }),
    );
    await act(async () => Promise.resolve());
    act(() => {
      result.current.updateDraft(
        setDraftField(result.current.envelope?.draft, "project.projectName", "卸载前保存"),
      );
    });
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(repository.commit).toHaveBeenCalledTimes(1);
  });
});
