import { v2 } from "@opentrad/document-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDraftField, setDraftField } from "./fieldPaths";
import { type FormIssue, SchemaForm } from "./SchemaForm";

afterEach(cleanup);

const BID_TEMPLATE_IDS = v2.TEMPLATE_IDS_V2.filter((templateId) => templateId.startsWith("bid."));

function Harness({
  templateId,
  initialDraft,
  issues = [],
}: {
  readonly templateId: string;
  readonly initialDraft?: unknown;
  readonly issues?: readonly FormIssue[];
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
        onDraftChange={setDraft}
      />
      <output data-testid="draft-state">{JSON.stringify(draft)}</output>
    </>
  );
}

describe("manifest-driven schema form", () => {
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
    expect(renderDuration).toBeLessThan(5_000);

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
