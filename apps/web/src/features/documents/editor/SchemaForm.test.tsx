import { v2 } from "@opentrad/document-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDraftField, setDraftField } from "./fieldPaths";
import { type FormIssue, SchemaForm } from "./SchemaForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BID_TEMPLATE_IDS = v2.TEMPLATE_IDS_V2.filter((templateId) => templateId.startsWith("bid."));

function Harness({
  templateId,
  initialDraft,
  issues = [],
  onDraftChange,
}: {
  readonly templateId: string;
  readonly initialDraft?: unknown;
  readonly issues?: readonly FormIssue[];
  readonly onDraftChange?: (draft: unknown) => void;
}) {
  const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
  const [draft, setDraft] = useState(
    initialDraft ??
      registration.createDraft({ id: "document-test", now: "2026-08-20T00:00:00.000Z" }),
  );
  return (
    <>
      <SchemaForm
        registration={registration}
        draft={draft}
        issues={issues}
        onDraftChange={(nextDraft) => {
          onDraftChange?.(nextDraft);
          setDraft(nextDraft);
        }}
      />
      <output data-testid="draft-state">{JSON.stringify(draft)}</output>
    </>
  );
}

describe("manifest-driven schema form", () => {
  it("layers every pending raw field and commits only after the whole candidate is valid", () => {
    const onDraftChange = vi.fn();
    render(<Harness templateId="quotation.service.project.v1" onDraftChange={onDraftChange} />);
    const projectName = screen.getByRole("textbox", { name: /项目名称.*必填/u });
    const unitPrice = screen.getByRole("textbox", { name: /未税单价.*必填/u });

    fireEvent.change(unitPrice, { target: { value: "" } });
    fireEvent.change(projectName, { target: { value: "多字段暂存项目" } });

    expect(onDraftChange).not.toHaveBeenCalled();
    expect(unitPrice).toHaveValue("");
    expect(projectName).toHaveValue("多字段暂存项目");
    expect(screen.getByRole("button", { name: "定位第一个错误" })).toBeVisible();

    fireEvent.change(unitPrice, { target: { value: "25" } });

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "project.projectName")).toBe("多字段暂存项目");
    expect(getDraftField(committed, "serviceLines.0.unitPriceMinor")).toBe("2500");
    expect(screen.queryByRole("button", { name: "定位第一个错误" })).not.toBeInTheDocument();
  });

  it("rebases pending raw input onto the latest parent attachment draft", () => {
    const registration = v2.V2_TEMPLATE_REGISTRY.get("contract.oem.processing.v1", "1.0.0");
    const draft = registration.createDraft({
      id: "pending-attachment",
      now: "2026-08-20T00:00:00Z",
    });
    const onDraftChange = vi.fn();
    const view = render(
      <SchemaForm registration={registration} draft={draft} onDraftChange={onDraftChange} />,
    );
    const product = screen.getByRole("group", { name: "委托产品 第 1 项" });
    const price = within(product).getByRole("textbox", { name: /单价.*必填/u });
    fireEvent.change(price, { target: { value: "not-money" } });
    expect(onDraftChange).not.toHaveBeenCalled();

    const withAttachment = registration.parseDraft(
      setDraftField(
        setDraftField(draft, "attachments", [
          {
            id: "drawing-latest",
            category: "technical",
            displayName: "最新图纸.pdf",
            mediaType: "application/pdf",
            pageCount: 2,
            required: true,
            status: "attached",
            includedInSubmission: true,
          },
        ]),
        "technical.drawingAttachmentIds",
        ["drawing-latest"],
      ),
    );
    view.rerender(
      <SchemaForm
        registration={registration}
        draft={withAttachment}
        onDraftChange={onDraftChange}
      />,
    );
    expect(price).toHaveValue("not-money");

    fireEvent.change(price, { target: { value: "25" } });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "technical.drawingAttachmentIds")).toEqual(["drawing-latest"]);
    expect(getDraftField(committed, "attachments.0.displayName")).toBe("最新图纸.pdf");
  });

  it("keeps invalid repeatable raw values with stable identities through reorder and delete", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    let draft = registration.createDraft({ id: "stable-raw", now: "2026-08-20T00:00:00Z" });
    const first = (getDraftField(draft, "serviceLines") as readonly Record<string, unknown>[])[0];
    if (!first) throw new Error("missing first service line");
    const second = registration.createRepeatableItem("serviceLines", {
      id: "service-second",
      now: "2026-08-20T00:00:00Z",
      draft,
    }) as Record<string, unknown>;
    draft = registration.parseDraft(
      setDraftField(draft, "serviceLines", [
        { ...first, serviceName: "第一项服务" },
        { ...second, serviceName: "第二项服务" },
      ]),
    );
    const onDraftChange = vi.fn();
    render(
      <Harness
        templateId={registration.definition.id}
        initialDraft={draft}
        onDraftChange={onDraftChange}
      />,
    );
    let rows = screen.getAllByRole("group", { name: /服务报价项 第 \d+ 项/u });
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (!firstRow || !secondRow) throw new Error("missing service rows");
    fireEvent.change(within(firstRow).getByRole("textbox", { name: /未税单价.*必填/u }), {
      target: { value: "bad-first" },
    });
    fireEvent.change(within(secondRow).getByRole("textbox", { name: /未税单价.*必填/u }), {
      target: { value: "bad-second" },
    });

    await user.click(within(secondRow).getByRole("button", { name: "上移" }));
    expect(onDraftChange).not.toHaveBeenCalled();
    rows = screen.getAllByRole("group", { name: /服务报价项 第 \d+ 项/u });
    expect(
      within(rows[0] as HTMLElement).getByRole("textbox", { name: /服务名称.*必填/u }),
    ).toHaveValue("第二项服务");
    expect(
      within(rows[0] as HTMLElement).getByRole("textbox", { name: /未税单价.*必填/u }),
    ).toHaveValue("bad-second");
    expect(
      within(rows[1] as HTMLElement).getByRole("textbox", { name: /未税单价.*必填/u }),
    ).toHaveValue("bad-first");

    await user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "删除" }));
    const remaining = screen.getByRole("group", { name: "服务报价项 第 1 项" });
    const remainingPrice = within(remaining).getByRole("textbox", { name: /未税单价.*必填/u });
    expect(within(remaining).getByRole("textbox", { name: /服务名称.*必填/u })).toHaveValue(
      "第一项服务",
    );
    expect(remainingPrice).toHaveValue("bad-first");
    expect(screen.queryByDisplayValue("bad-second")).not.toBeInTheDocument();

    fireEvent.change(remainingPrice, { target: { value: "25" } });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const committedRows = getDraftField(onDraftChange.mock.calls[0]?.[0], "serviceLines");
    expect(committedRows).toHaveLength(1);
    expect(getDraftField(committedRows, "0.serviceName")).toBe("第一项服务");
    expect(getDraftField(committedRows, "0.unitPriceMinor")).toBe("2500");
  });

  it("keeps idless repeatable raw values with session keys through reorder and delete", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("bid.construction.works.v1", "1.0.0");
    let draft = registration.createDraft({ id: "session-raw", now: "2026-08-20T00:00:00Z" });
    const laborA = registration.createRepeatableItem("laborPlan", {
      id: "unused-a",
      now: "2026-08-20T00:00:00Z",
      draft,
    }) as Record<string, unknown>;
    const laborB = registration.createRepeatableItem("laborPlan", {
      id: "unused-b",
      now: "2026-08-20T00:00:00Z",
      draft,
    }) as Record<string, unknown>;
    draft = registration.parseDraft(
      setDraftField(draft, "laborPlan", [
        { ...laborA, trade: "木工" },
        { ...laborB, trade: "电工" },
      ]),
    );
    const onDraftChange = vi.fn();
    render(
      <Harness
        templateId={registration.definition.id}
        initialDraft={draft}
        onDraftChange={onDraftChange}
      />,
    );
    let rows = screen.getAllByRole("group", { name: /劳动力计划 第 \d+ 项/u });
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (!firstRow || !secondRow) throw new Error("missing labor rows");
    fireEvent.change(within(firstRow).getByRole("textbox", { name: /人数.*必填/u }), {
      target: { value: "bad-wood" },
    });
    fireEvent.change(within(secondRow).getByRole("textbox", { name: /人数.*必填/u }), {
      target: { value: "bad-electric" },
    });

    await user.click(within(secondRow).getByRole("button", { name: "上移" }));
    rows = screen.getAllByRole("group", { name: /劳动力计划 第 \d+ 项/u });
    expect(
      within(rows[0] as HTMLElement).getByRole("textbox", { name: /工种.*必填/u }),
    ).toHaveValue("电工");
    expect(
      within(rows[0] as HTMLElement).getByRole("textbox", { name: /人数.*必填/u }),
    ).toHaveValue("bad-electric");
    expect(
      within(rows[1] as HTMLElement).getByRole("textbox", { name: /人数.*必填/u }),
    ).toHaveValue("bad-wood");
    expect(onDraftChange).not.toHaveBeenCalled();

    await user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "删除" }));
    const remaining = screen.getByRole("group", { name: "劳动力计划 第 1 项" });
    const count = within(remaining).getByRole("textbox", { name: /人数.*必填/u });
    expect(within(remaining).getByRole("textbox", { name: /工种.*必填/u })).toHaveValue("木工");
    expect(count).toHaveValue("bad-wood");
    expect(screen.queryByDisplayValue("bad-electric")).not.toBeInTheDocument();

    fireEvent.change(count, { target: { value: "2" } });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const committed = getDraftField(onDraftChange.mock.calls[0]?.[0], "laborPlan");
    expect(committed).toHaveLength(1);
    expect(getDraftField(committed, "0.trade")).toBe("木工");
    expect(getDraftField(committed, "0.count")).toBe(2);
  });

  it.each(BID_TEMPLATE_IDS)(
    "stages %s guarantee facts and commits the complete combination exactly once",
    async (templateId) => {
      const user = userEvent.setup();
      const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      let draft = registration.createDraft({
        id: `guarantee-${templateId}`,
        now: "2026-08-20T00:00:00.000Z",
      });
      draft = setDraftField(draft, "attachments", [
        {
          id: "solicitation-main",
          category: "other",
          displayName: "招标文件.pdf",
          mediaType: "application/pdf",
          pageCount: 8,
          required: true,
          status: "attached",
          includedInSubmission: false,
        },
      ]);
      draft = registration.parseDraft(
        setDraftField(draft, "evidenceRefs", [
          {
            id: "solicitation-source",
            kind: "solicitation",
            attachmentId: "solicitation-main",
            page: 1,
            sourceRef: "招标文件保证要求章节",
          },
        ]),
      );
      render(<Harness templateId={templateId} initialDraft={draft} />);

      const required = screen.getByRole("checkbox", { name: /要求投标保证/u });
      await user.click(required);
      expect(required).toBeChecked();

      const amount = document.querySelector<HTMLInputElement>(
        '[data-field-path="source.guaranteeRequirement.amountMinor"]',
      );
      expect(amount).not.toBeNull();
      if (!amount) throw new Error("缺少保证要求金额输入");
      await user.clear(amount);
      await user.type(amount, "100.00");
      await user.selectOptions(
        screen.getByRole("listbox", { name: /保证要求来源/u }),
        "solicitation-source",
      );
      await user.click(screen.getByRole("button", { name: "添加保证方式" }));
      await user.type(screen.getByRole("textbox", { name: "新增保证方式" }), "银行保函");

      const beforeConfirm = JSON.parse(screen.getByTestId("draft-state").textContent ?? "null");
      expect(getDraftField(beforeConfirm, "source.guaranteeRequirement")).toEqual({
        required: false,
        allowedMethods: [],
        sourceRefIds: [],
      });

      await user.click(screen.getByRole("button", { name: "确认添加保证方式" }));
      const committed = JSON.parse(screen.getByTestId("draft-state").textContent ?? "null");
      expect(getDraftField(committed, "source.guaranteeRequirement")).toEqual({
        required: true,
        allowedMethods: ["银行保函"],
        amountMinor: "10000",
        sourceRefIds: ["solicitation-source"],
      });
      expect(screen.queryByRole("button", { name: "定位第一个错误" })).not.toBeInTheDocument();
    },
  );

  it("can discard or atomically disable a staged guarantee without losing other valid edits", async () => {
    const user = userEvent.setup();
    const templateId = "bid.government.goods.v1";
    const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
    let draft = registration.createDraft({ id: "guarantee-cancel", now: "2026-08-20T00:00:00Z" });
    draft = registration.parseDraft(
      setDraftField(
        setDraftField(draft, "attachments", [
          {
            id: "solicitation-main",
            category: "other",
            displayName: "招标文件.pdf",
            mediaType: "application/pdf",
            pageCount: 8,
            required: true,
            status: "attached",
            includedInSubmission: false,
          },
        ]),
        "evidenceRefs",
        [
          {
            id: "solicitation-source",
            kind: "solicitation",
            attachmentId: "solicitation-main",
            page: 1,
            sourceRef: "保证要求章节",
          },
        ],
      ),
    );
    const onDraftChange = vi.fn();
    render(<Harness templateId={templateId} initialDraft={draft} onDraftChange={onDraftChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: /采购人\/招标人.*必填/u }), {
      target: { value: "保留的采购人" },
    });
    onDraftChange.mockClear();

    await user.click(screen.getByRole("checkbox", { name: /要求投标保证/u }));
    const amount = document.querySelector<HTMLInputElement>(
      '[data-field-path="source.guaranteeRequirement.amountMinor"]',
    );
    if (!amount) throw new Error("missing guarantee amount");
    fireEvent.change(amount, { target: { value: "100" } });
    await user.selectOptions(
      screen.getByRole("listbox", { name: /保证要求来源/u }),
      "solicitation-source",
    );
    expect(onDraftChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "放弃暂存保证要求" }));
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    let committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "source.guaranteeRequirement")).toEqual({
      required: false,
      allowedMethods: [],
      sourceRefIds: [],
    });
    expect(getDraftField(committed, "source.issuer")).toBe("保留的采购人");

    onDraftChange.mockClear();
    await user.click(screen.getByRole("checkbox", { name: /要求投标保证/u }));
    fireEvent.change(amount, { target: { value: "200" } });
    await user.click(screen.getByRole("checkbox", { name: /要求投标保证/u }));
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "source.guaranteeRequirement")).toEqual({
      required: false,
      allowedMethods: [],
      sourceRefIds: [],
    });
  });

  it("restores the valid guarantee baseline when staged changes are discarded", async () => {
    const user = userEvent.setup();
    const templateId = "bid.government.goods.v1";
    const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
    let draft = registration.createDraft({ id: "guarantee-baseline", now: "2026-08-20T00:00:00Z" });
    draft = registration.parseDraft(
      setDraftField(
        setDraftField(
          setDraftField(draft, "attachments", [
            {
              id: "solicitation-main",
              category: "other",
              displayName: "招标文件.pdf",
              mediaType: "application/pdf",
              pageCount: 8,
              required: true,
              status: "attached",
              includedInSubmission: false,
            },
          ]),
          "evidenceRefs",
          [
            {
              id: "solicitation-source",
              kind: "solicitation",
              attachmentId: "solicitation-main",
              page: 1,
              sourceRef: "保证要求章节",
            },
          ],
        ),
        "source.guaranteeRequirement",
        {
          required: true,
          allowedMethods: ["原银行保函"],
          amountMinor: "50000",
          sourceRefIds: ["solicitation-source"],
        },
      ),
    );
    const onDraftChange = vi.fn();
    render(<Harness templateId={templateId} initialDraft={draft} onDraftChange={onDraftChange} />);

    await user.click(
      within(screen.getByRole("region", { name: "保证方式" })).getByRole("button", {
        name: "删除",
      }),
    );
    expect(onDraftChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "放弃暂存保证要求" }));

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(getDraftField(onDraftChange.mock.calls[0]?.[0], "source.guaranteeRequirement")).toEqual({
      required: true,
      allowedMethods: ["原银行保函"],
      amountMinor: "50000",
      sourceRefIds: ["solicitation-source"],
    });
  });

  it("resets staged guarantee state when the parent draft identity changes", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    const first = registration.createDraft({ id: "guarantee-first", now: "2026-08-20T00:00:00Z" });
    const second = registration.createDraft({
      id: "guarantee-second",
      now: "2026-08-20T00:00:00Z",
    });
    const view = render(
      <SchemaForm registration={registration} draft={first} onDraftChange={vi.fn()} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /要求投标保证/u }));
    expect(screen.getByRole("button", { name: "放弃暂存保证要求" })).toBeVisible();

    view.rerender(
      <SchemaForm registration={registration} draft={second} onDraftChange={vi.fn()} />,
    );

    expect(screen.getByRole("checkbox", { name: /要求投标保证/u })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "放弃暂存保证要求" })).not.toBeInTheDocument();
  });

  it("discards descendant guarantee patches back to the exact baseline while other raw input is pending", async () => {
    const user = userEvent.setup();
    const templateId = "bid.government.goods.v1";
    const registration = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
    const baselineGuarantee = {
      required: true,
      allowedMethods: ["原银行保函"],
      amountMinor: "50000",
      sourceRefIds: ["solicitation-source"],
    };
    let draft = registration.createDraft({
      id: "guarantee-descendant",
      now: "2026-08-20T00:00:00Z",
    });
    draft = registration.parseDraft(
      setDraftField(
        setDraftField(
          setDraftField(draft, "attachments", [
            {
              id: "solicitation-main",
              category: "other",
              displayName: "招标文件.pdf",
              mediaType: "application/pdf",
              pageCount: 8,
              required: true,
              status: "attached",
              includedInSubmission: false,
            },
          ]),
          "evidenceRefs",
          [
            {
              id: "solicitation-source",
              kind: "solicitation",
              attachmentId: "solicitation-main",
              page: 1,
              sourceRef: "保证要求章节",
            },
          ],
        ),
        "source.guaranteeRequirement",
        baselineGuarantee,
      ),
    );
    const onDraftChange = vi.fn();
    render(<Harness templateId={templateId} initialDraft={draft} onDraftChange={onDraftChange} />);

    const unrelated = screen.getByRole("textbox", { name: /明细合计.*必填/u });
    fireEvent.change(unrelated, { target: { value: "not-money" } });
    const required = screen.getByRole("checkbox", { name: /要求投标保证/u });
    await user.click(required);
    await user.click(required);
    await user.click(screen.getByRole("button", { name: "添加保证方式" }));
    await user.type(screen.getByRole("textbox", { name: "新增保证方式" }), "新保证方式");
    await user.click(screen.getByRole("button", { name: "确认添加保证方式" }));
    await user.click(
      within(screen.getByRole("region", { name: "保证方式" })).getByRole("button", {
        name: "删除",
      }),
    );
    expect(onDraftChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "放弃暂存保证要求" }));
    fireEvent.change(unrelated, { target: { value: "100" } });

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "source.guaranteeRequirement")).toEqual(baselineGuarantee);
    expect(getDraftField(committed, "priceDeclaration.itemizedTotalMinor")).toBe("10000");
    expect(screen.queryByRole("button", { name: "定位第一个错误" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放弃暂存保证要求" })).not.toBeInTheDocument();
  });

  it("exposes a safe add state for all 116 manifest repeatables from createDraft", () => {
    let total = 0;
    let fixed = 0;
    let blocked = 0;
    for (const registration of v2.V2_TEMPLATE_REGISTRY.list()) {
      const draft = registration.createDraft({
        id: `inventory-${registration.definition.id}`,
        now: "2026-08-20T00:00:00.000Z",
      });
      const rendered = render(
        <Harness templateId={registration.definition.id} initialDraft={draft} />,
      );
      for (const field of registration.definition.fieldManifest) {
        if (field.control !== "repeatable") continue;
        total += 1;
        const region = screen.getByRole("region", { name: field.label });
        const add = within(region).queryByRole("button", { name: `添加${field.label}` });
        if (field.minItems === field.maxItems) {
          fixed += 1;
          expect(add, `${registration.definition.id}:${field.path}`).not.toBeInTheDocument();
          continue;
        }
        expect(add, `${registration.definition.id}:${field.path}`).toBeInTheDocument();
        if (field.path === "source.guaranteeRequirement.allowedMethods") {
          expect(add, `${registration.definition.id}:${field.path}`).toBeEnabled();
          continue;
        }
        let directlyAddable = false;
        try {
          const item = registration.createRepeatableItem(field.path, {
            id: `probe-${field.path.replaceAll(".", "-")}`,
            now: "2026-08-20T00:00:00.000Z",
            draft,
          });
          registration.parseDraft(
            setDraftField(draft, field.path, [
              ...((getDraftField(draft, field.path) as readonly unknown[] | undefined) ?? []),
              item,
            ]),
          );
          directlyAddable = true;
        } catch {
          blocked += 1;
        }
        if (directlyAddable) {
          if (add?.hasAttribute("disabled")) {
            throw new Error(`${registration.definition.id}:${field.path} should be enabled`);
          }
        } else {
          if (!add?.hasAttribute("disabled")) {
            throw new Error(`${registration.definition.id}:${field.path} should be disabled`);
          }
          expect(add, `${registration.definition.id}:${field.path}`).toHaveAccessibleDescription(
            /请先(?:创建|附加)/u,
          );
        }
      }
      rendered.unmount();
    }
    expect(total).toBe(116);
    expect(fixed).toBe(5);
    expect(blocked).toBeGreaterThan(0);
  }, 20_000);

  it("uses an existing canonical requirement id for dependent matrix factories", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    let draft = registration.createDraft({ id: "canonical-source", now: "2026-08-20T00:00:00Z" });
    draft = setDraftField(draft, "attachments", [
      {
        id: "solicitation-file",
        category: "other",
        displayName: "招标文件.pdf",
        mediaType: "application/pdf",
        pageCount: 8,
        required: true,
        status: "attached",
        includedInSubmission: false,
      },
    ]);
    draft = setDraftField(draft, "evidenceRefs", [
      {
        id: "solicitation-source",
        kind: "solicitation",
        attachmentId: "solicitation-file",
        page: 1,
        sourceRef: "招标文件第一章",
      },
    ]);
    draft = registration.parseDraft(draft);
    const requirement = registration.createRepeatableItem("requirements", {
      id: "requirement-canonical",
      now: "2026-08-20T00:00:00Z",
      draft,
    });
    draft = registration.parseDraft(setDraftField(draft, "requirements", [requirement]));
    render(<Harness templateId={registration.definition.id} initialDraft={draft} />);

    const addMatrix = screen.getByRole("button", { name: "添加技术响应矩阵" });
    expect(addMatrix).toBeDisabled();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "选择技术响应矩阵来源" }),
      "requirement-canonical",
    );
    expect(addMatrix).toBeEnabled();
    await user.click(addMatrix);

    expect(screen.getByRole("group", { name: "技术响应矩阵 第 1 项" })).toBeVisible();
    expect(screen.getByTestId("draft-state")).toHaveTextContent("requirement-canonical");
  });

  it("filters exact factory sources by static item constraints and exhausts compatible rows", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    let draft = registration.createDraft({ id: "category-sources", now: "2026-08-20T00:00:00Z" });
    draft = registration.parseDraft(
      setDraftField(
        setDraftField(draft, "attachments", [
          {
            id: "solicitation-file",
            category: "other",
            displayName: "招标文件.pdf",
            mediaType: "application/pdf",
            pageCount: 8,
            required: true,
            status: "attached",
            includedInSubmission: false,
          },
        ]),
        "evidenceRefs",
        [
          {
            id: "solicitation-source",
            kind: "solicitation",
            attachmentId: "solicitation-file",
            page: 1,
            sourceRef: "招标文件第一章",
          },
        ],
      ),
    );
    const seed = registration.createRepeatableItem("requirements", {
      id: "technical-source",
      now: "2026-08-20T00:00:00Z",
      draft,
    }) as Record<string, unknown>;
    draft = registration.parseDraft(
      setDraftField(draft, "requirements", [
        { ...seed, id: "technical-source", category: "technical", requirementText: "技术参数" },
        {
          ...seed,
          id: "commercial-source",
          category: "commercial",
          requirementText: "付款条款",
        },
        {
          ...seed,
          id: "qualification-source",
          category: "qualification",
          requirementText: "资格条件",
        },
      ]),
    );
    render(<Harness templateId={registration.definition.id} initialDraft={draft} />);

    const technicalSource = screen.getByRole("combobox", { name: "选择技术响应矩阵来源" });
    const businessSource = screen.getByRole("combobox", { name: "选择商务响应矩阵来源" });
    expect(
      within(technicalSource)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["", "technical-source"]);
    expect(
      within(businessSource)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["", "commercial-source"]);

    await user.selectOptions(technicalSource, "technical-source");
    await user.click(screen.getByRole("button", { name: "添加技术响应矩阵" }));
    await user.selectOptions(businessSource, "commercial-source");
    await user.click(screen.getByRole("button", { name: "添加商务响应矩阵" }));

    expect(
      screen.queryByRole("combobox", { name: "选择技术响应矩阵来源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "选择商务响应矩阵来源" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加技术响应矩阵" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加商务响应矩阵" })).toBeDisabled();
    expect(screen.getByTestId("draft-state")).toHaveTextContent("qualification-source");
  });

  it("disables dependent factory actions until a canonical source exists", () => {
    render(<Harness templateId="bid.government.goods.v1" />);

    const matrix = screen.getByRole("button", { name: "添加技术响应矩阵" });
    expect(matrix).toBeDisabled();
    expect(matrix).toHaveAccessibleDescription(/请先创建.*要求/u);
  });

  it("derives a large dependent factory selector from manifest sources without render parsing", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("bid.government.goods.v1", "1.0.0");
    let draft = registration.createDraft({ id: "large-matrix", now: "2026-08-20T00:00:00Z" });
    draft = registration.parseDraft(
      setDraftField(
        setDraftField(draft, "attachments", [
          {
            id: "solicitation-file",
            category: "other",
            displayName: "招标文件.pdf",
            mediaType: "application/pdf",
            pageCount: 8,
            required: true,
            status: "attached",
            includedInSubmission: false,
          },
        ]),
        "evidenceRefs",
        [
          {
            id: "solicitation-source",
            kind: "solicitation",
            attachmentId: "solicitation-file",
            page: 1,
            sourceRef: "招标文件第一章",
          },
        ],
      ),
    );
    const requirementSeed = registration.createRepeatableItem("requirements", {
      id: "requirement-0",
      now: "2026-08-20T00:00:00Z",
      draft,
    }) as Record<string, unknown>;
    const requirements = Array.from({ length: 100 }, (_, index) => ({
      ...requirementSeed,
      id: `requirement-${index}`,
    }));
    draft = registration.parseDraft(setDraftField(draft, "requirements", requirements));
    const deviationSeed = registration.createRepeatableItem("technicalDeviations", {
      id: "requirement-0",
      now: "2026-08-20T00:00:00Z",
      draft,
    }) as Record<string, unknown>;
    const deviations = Array.from({ length: 99 }, (_, index) => ({
      ...deviationSeed,
      requirementId: `requirement-${index}`,
    }));
    draft = registration.parseDraft(setDraftField(draft, "technicalDeviations", deviations));

    const manifest = registration.definition.fieldManifest.filter(
      (field) => field.path === "technicalDeviations",
    );
    const createRepeatableItem = vi.fn(registration.createRepeatableItem);
    const parseDraft = vi.fn(registration.parseDraft);
    const trackedRegistration = {
      ...registration,
      definition: { ...registration.definition, fieldManifest: manifest },
      createRepeatableItem,
      parseDraft,
    };
    createRepeatableItem.mockClear();
    parseDraft.mockClear();
    const structuredCloneSpy = vi.spyOn(globalThis, "structuredClone");
    const startedAt = performance.now();
    render(
      <SchemaForm
        registration={trackedRegistration}
        draft={draft}
        onDraftChange={() => undefined}
      />,
    );
    const renderDuration = performance.now() - startedAt;

    expect(createRepeatableItem).not.toHaveBeenCalled();
    expect(parseDraft).not.toHaveBeenCalled();
    expect(structuredCloneSpy).toHaveBeenCalledTimes(1);
    expect(renderDuration).toBeLessThan(2_000);

    const source = screen.getByRole("combobox", { name: "选择技术偏差来源" });
    expect(source).toHaveValue("");
    expect(within(source).getAllByRole("option")).toHaveLength(2);
    await user.selectOptions(source, "requirement-99");
    await user.click(screen.getByRole("button", { name: "添加技术偏差" }));

    expect(createRepeatableItem).toHaveBeenCalledTimes(1);
    expect(parseDraft).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("renders Chinese and English inputs for all 62 localized-text fields", () => {
    let localizedFields = 0;
    for (const registration of v2.V2_TEMPLATE_REGISTRY.list()) {
      const draft = registration.createDraft({
        id: "localized-count",
        now: "2026-08-20T00:00:00Z",
      });
      const rendered = render(
        <Harness templateId={registration.definition.id} initialDraft={draft} />,
      );
      let expectedVisibleFields = 0;
      for (const field of registration.definition.fieldManifest) {
        if (field.valueKind === "localized-text") {
          localizedFields += 1;
          if (
            !field.visibleWhen ||
            getDraftField(draft, field.visibleWhen.path) === field.visibleWhen.equals
          ) {
            expectedVisibleFields += 1;
          }
        }
        if (field.control === "repeatable" && field.item.kind === "object") {
          const rows = getDraftField(draft, field.path);
          const rowCount = Array.isArray(rows) ? rows.length : 0;
          for (const itemField of field.item.fields) {
            if (itemField.valueKind !== "localized-text") continue;
            localizedFields += 1;
            if (!itemField.visibleWhen) expectedVisibleFields += rowCount;
          }
        }
      }
      expect(screen.queryAllByRole("textbox", { name: /（中文）/u })).toHaveLength(
        expectedVisibleFields,
      );
      expect(screen.queryAllByRole("textbox", { name: /（英文）/u })).toHaveLength(
        expectedVisibleFields,
      );
      rendered.unmount();
    }
    expect(localizedFields).toBe(62);
  }, 20_000);

  it("edits both localized-text branches without discarding either language", () => {
    render(<Harness templateId="quotation.export.bilingual.v1" />);
    const titleZh = screen.getByRole("textbox", { name: /买方参考.*中文/u });
    const titleEn = screen.getByRole("textbox", { name: /买方参考.*英文/u });

    fireEvent.change(titleZh, { target: { value: "出口设备报价" } });
    fireEvent.change(titleEn, { target: { value: "Export Equipment Quotation" } });

    expect(screen.getByTestId("draft-state")).toHaveTextContent("出口设备报价");
    expect(screen.getByTestId("draft-state")).toHaveTextContent("Export Equipment Quotation");
  });

  it("renders scalar controls by section and applies visibleWhen exactly", async () => {
    const user = userEvent.setup();
    render(<Harness templateId="quotation.service.project.v1" />);

    expect(screen.getByRole("group", { name: "quote-meta" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /项目名称.*必填/u })).toHaveValue("待填写");
    expect(screen.getByLabelText(/出具日期.*必填/u)).toHaveAttribute("type", "date");
    expect(screen.getByRole("combobox", { name: /币种.*必填/u })).toHaveValue("CNY");
    expect(screen.getByRole("checkbox", { name: /是否涉及个人信息.*必填/u })).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "个人信息处理条款" })).not.toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: /项目名称.*必填/u }));
    await user.type(screen.getByRole("textbox", { name: /项目名称.*必填/u }), "工厂节能改造咨询");
    expect(screen.getByTestId("draft-state")).toHaveTextContent("工厂节能改造咨询");

    await user.click(screen.getByRole("checkbox", { name: /是否涉及个人信息.*必填/u }));
    expect(screen.getByRole("textbox", { name: "个人信息处理条款" })).toBeVisible();
  });

  it("converges contract effective-mode fields in both directions without hidden stale leaves", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("contract.sale.domestic-b2b.v1", "1.0.0");
    const draft = registration.parseDraft(
      setDraftField(
        setDraftField(
          registration.createDraft({ id: "effective-switch", now: "2026-08-20T00:00:00Z" }),
          "meta.effectiveMode",
          "condition",
        ),
        "meta.effectiveCondition",
        "验收完成后生效",
      ),
    );
    const onDraftChange = vi.fn();
    render(
      <Harness
        templateId={registration.definition.id}
        initialDraft={draft}
        onDraftChange={onDraftChange}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: /生效方式.*必填/u }), "date");
    expect(onDraftChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("生效日期"), {
      target: { value: "2026-09-01" },
    });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    let committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "meta.effectiveMode")).toBe("date");
    expect(getDraftField(committed, "meta.effectiveDate")).toBe("2026-09-01");
    expect(getDraftField(committed, "meta.effectiveCondition")).toBeUndefined();

    onDraftChange.mockClear();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /生效方式.*必填/u }),
      "condition",
    );
    expect(onDraftChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "生效条件" }), {
      target: { value: "双方盖章并完成备案" },
    });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "meta.effectiveCondition")).toBe("双方盖章并完成备案");
    expect(getDraftField(committed, "meta.effectiveDate")).toBeUndefined();
  });

  it("converges court and arbitration fields in both directions", async () => {
    const user = userEvent.setup();
    const templateId = "contract.sale.domestic-b2b.v1";
    const onDraftChange = vi.fn();
    render(<Harness templateId={templateId} onDraftChange={onDraftChange} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /争议解决方式.*必填/u }),
      "arbitration",
    );
    expect(onDraftChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "仲裁委员会" }), {
      target: { value: "深圳国际仲裁院" },
    });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    let committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "generalTerms.arbitrationCommission")).toBe("深圳国际仲裁院");
    expect(getDraftField(committed, "generalTerms.court")).toBeUndefined();

    onDraftChange.mockClear();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /争议解决方式.*必填/u }),
      "court",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "管辖法院" }), {
      target: { value: "深圳市南山区人民法院" },
    });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    committed = onDraftChange.mock.calls[0]?.[0];
    expect(getDraftField(committed, "generalTerms.court")).toBe("深圳市南山区人民法院");
    expect(getDraftField(committed, "generalTerms.arbitrationCommission")).toBeUndefined();
  });

  it("preserves a hidden optional value when the schema permits it", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
    const draft = registration.parseDraft(
      setDraftField(
        setDraftField(
          registration.createDraft({ id: "hidden-preserved", now: "2026-08-20T00:00:00Z" }),
          "dataHandling.personalDataInvolved",
          true,
        ),
        "dataHandling.processingTerms",
        "仅用于履约联络并在项目结束后删除",
      ),
    );
    const onDraftChange = vi.fn();
    render(
      <Harness
        templateId={registration.definition.id}
        initialDraft={draft}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /是否涉及个人信息.*必填/u }));
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(getDraftField(onDraftChange.mock.calls[0]?.[0], "dataHandling.processingTerms")).toBe(
      "仅用于履约联络并在项目结束后删除",
    );
  });

  it("uses registration factories for growable object rows and supports reorder and remove", async () => {
    const user = userEvent.setup();
    render(<Harness templateId="quotation.service.project.v1" />);

    expect(screen.getAllByRole("group", { name: /服务报价项 第 \d+ 项/u })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "添加服务报价项" }));
    expect(screen.getAllByRole("group", { name: /服务报价项 第 \d+ 项/u })).toHaveLength(2);

    const secondRow = screen.getByRole("group", { name: "服务报价项 第 2 项" });
    await user.clear(within(secondRow).getByRole("textbox", { name: /服务名称.*必填/u }));
    await user.type(
      within(secondRow).getByRole("textbox", { name: /服务名称.*必填/u }),
      "现场能源审计",
    );
    expect(screen.getByTestId("draft-state")).toHaveTextContent("现场能源审计");

    await user.click(within(secondRow).getByRole("button", { name: "上移" }));
    expect(
      within(screen.getByRole("group", { name: "服务报价项 第 1 项" })).getByRole("textbox", {
        name: /服务名称.*必填/u,
      }),
    ).toHaveValue("现场能源审计");

    await user.click(
      within(screen.getByRole("group", { name: "服务报价项 第 1 项" })).getByRole("button", {
        name: "删除",
      }),
    );
    expect(screen.getAllByRole("group", { name: /服务报价项 第 \d+ 项/u })).toHaveLength(1);
  });

  it("renders and edits top-level value repeatables declared by the manifest", async () => {
    const user = userEvent.setup();
    render(<Harness templateId="contract.oem.processing.v1" />);

    await user.click(screen.getByRole("button", { name: "添加材料清单" }));
    const material = screen.getByRole("textbox", { name: "材料 第 1 项" });
    fireEvent.change(material, { target: { value: "304 不锈钢板" } });

    expect(material).toHaveValue("304 不锈钢板");
    expect(screen.getByTestId("draft-state")).toHaveTextContent("304 不锈钢板");
  });

  it("keeps parsed reorder controls while hiding add and delete for fixed signer rows", async () => {
    const user = userEvent.setup();
    render(<Harness templateId="contract.sale.domestic-b2b.v1" />);

    expect(screen.getAllByRole("group", { name: /签署方 第 \d+ 项/u })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "添加签署方" })).not.toBeInTheDocument();
    const signerRows = screen.getAllByRole("group", { name: /签署方 第 \d+ 项/u });
    const firstRow = signerRows[0];
    const secondRow = signerRows[1];
    if (!firstRow || !secondRow) throw new Error("missing fixed signer rows");
    for (const row of signerRows) {
      expect(within(row).queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    }
    const firstDown = within(firstRow).getByRole("button", { name: "下移" });
    expect(within(firstRow).getByRole("button", { name: "上移" })).toBeDisabled();
    expect(firstDown).toBeEnabled();
    expect(within(secondRow).getByRole("button", { name: "上移" })).toBeEnabled();
    expect(within(secondRow).getByRole("button", { name: "下移" })).toBeDisabled();

    await user.click(firstDown);

    expect(
      within(screen.getByRole("group", { name: "签署方 第 2 项" })).getByRole("button", {
        name: "上移",
      }),
    ).toHaveFocus();
    expect(
      within(screen.getByRole("group", { name: "签署方 第 2 项" })).getByRole("textbox", {
        name: /签署角色.*中文/u,
      }),
    ).toHaveValue("卖方");
  });

  it("derives dynamic options from the declared source and edits nested string lists", async () => {
    const user = userEvent.setup();
    const registration = v2.V2_TEMPLATE_REGISTRY.get("bid.government.services.v1", "1.0.0");
    let draft = registration.createDraft({ id: "bid-test", now: "2026-08-20T00:00:00.000Z" });
    draft = setDraftField(draft, "attachments", [
      {
        id: "source-main",
        category: "other",
        displayName: "招标文件.pdf",
        mediaType: "application/pdf",
        pageCount: 10,
        required: true,
        sourceRef: "采购人提供",
        status: "attached",
        includedInSubmission: false,
      },
    ]);
    draft = registration.parseDraft(
      setDraftField(draft, "evidenceRefs", [
        {
          id: "source-1",
          kind: "solicitation",
          attachmentId: "source-main",
          page: 1,
          sourceRef: "招标文件 第一章",
        },
      ]),
    );
    render(<Harness templateId="bid.government.services.v1" initialDraft={draft} />);

    const guaranteeSources = screen.getByRole("listbox", { name: /保证要求来源/u });
    expect(within(guaranteeSources).getAllByRole("option").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "添加工作包" }));
    const firstWorkPackage = screen.getByRole("group", { name: "工作包 第 1 项" });
    await user.click(within(firstWorkPackage).getByRole("button", { name: "添加交付内容" }));
    expect(
      within(firstWorkPackage).getByRole("textbox", { name: /交付内容 第 1 项/u }),
    ).toBeVisible();
  });

  it("connects path issues to controls and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        templateId="quotation.service.project.v1"
        issues={[{ path: "project.projectName", message: "项目名称不能为空" }]}
      />,
    );

    const projectName = screen.getByRole("textbox", { name: /项目名称.*必填/u });
    const describedBy = projectName.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent("项目名称不能为空");

    await user.click(screen.getByRole("button", { name: "定位第一个错误" }));
    expect(projectName).toHaveFocus();
  });
});
