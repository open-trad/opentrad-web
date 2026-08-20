import { v2 } from "@opentrad/document-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setDraftField } from "./fieldPaths";
import { type FormIssue, SchemaForm } from "./SchemaForm";

afterEach(cleanup);

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

  it("hides add and delete controls for fixed two-party signer rows", () => {
    render(<Harness templateId="contract.sale.domestic-b2b.v1" />);

    expect(screen.getAllByRole("group", { name: /签署方 第 \d+ 项/u })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "添加签署方" })).not.toBeInTheDocument();
    const signerRows = screen.getAllByRole("group", { name: /签署方 第 \d+ 项/u });
    for (const row of signerRows) {
      expect(within(row).queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    }
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
