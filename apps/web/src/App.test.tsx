import { v2 } from "@opentrad/document-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const renderAt = (path = "/") => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("首页导航与工具入口", () => {
  test("展示品牌、核心导航和四个可访问入口", () => {
    renderAt();

    expect(screen.getByRole("heading", { name: "专业的开源商贸单证工具包" })).toBeVisible();
    expect(screen.getByText("从创建、编辑到转换，满足您的全球贸易文档需求")).toBeVisible();
    expect(screen.queryByText("全球贸易文档工作台")).not.toBeInTheDocument();
    expect(screen.queryByText(/智能填写/)).not.toBeInTheDocument();

    const brand = screen.getByRole("link", { name: "OpenTrad 开源商贸" });
    const avatar = brand.querySelector("img");
    expect(avatar).toHaveAttribute("src", "/brand/open-trad.png");
    expect(avatar).toHaveAttribute("alt", "");
    expect(within(brand).getByText("OpenTrad")).toBeVisible();
    expect(within(brand).getByText("开源商贸")).toBeVisible();

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    for (const label of ["首页", "模板中心", "格式转换", "帮助文档", "关于我们"]) {
      expect(within(navigation).getByRole("link", { name: label })).toBeVisible();
    }
    const coreTools = screen.getByRole("region", { name: "核心工具" });
    for (const label of ["格式转换", "报价单", "合同", "标书"]) {
      expect(within(coreTools).getByRole("link", { name: new RegExp(label) })).toBeVisible();
    }
  });

  test("首页入口会进入对应的真实工作区", async () => {
    const user = userEvent.setup();
    renderAt();

    await user.click(screen.getByRole("link", { name: /报价单/ }));
    expect(await screen.findByRole("heading", { name: "标准商品报价单" })).toBeVisible();
  });

  test("尚未开放的页头动作明确禁用", () => {
    renderAt();

    const languageButton = screen.getByRole("button", { name: /简体中文.*第二阶段开放/ });
    expect(languageButton).toBeDisabled();
    expect(languageButton).toHaveAttribute("title", expect.stringMatching(/第二阶段开放/));
  });
});

describe("模板中心", () => {
  test("分类和搜索会真实筛选模板卡片", async () => {
    const user = userEvent.setup();
    renderAt("/templates");

    expect(
      screen.getByText("15 份本地模板，覆盖报价、合同与标书，可按分类和语言快速筛选"),
    ).toBeVisible();
    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(15);
    expect(screen.getAllByRole("link", { name: /查看详情/ })).toHaveLength(15);
    await user.click(screen.getByRole("button", { name: /报价单/ }));
    expect(new URLSearchParams(window.location.search).get("category")).toBe("报价单");
    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(5);
    expect(screen.getAllByRole("link", { name: /查看详情/ })).toHaveLength(5);
    expect(screen.getByText("标准货物报价单")).toBeVisible();
    expect(screen.queryByText("政府采购货物投标文件")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "搜索模板" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索模板" }), "项目服务");
    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(1);
    expect(screen.getByText("项目服务报价单")).toBeVisible();
  });

  test("首页合同入口按 URL 筛选并进入真实模板说明", async () => {
    const user = userEvent.setup();
    renderAt();

    const coreTools = screen.getByRole("region", { name: "核心工具" });
    await user.click(within(coreTools).getByRole("link", { name: /合同/ }));
    expect(window.location.pathname).toBe("/templates");
    expect(new URLSearchParams(window.location.search).get("category")).toBe("合同");
    expect(screen.getAllByRole("link", { name: /查看详情/ })).toHaveLength(5);
    expect(screen.getByText("国内货物销售合同")).toBeVisible();
    expect(screen.getByText("商务服务合同")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "查看详情：商务服务合同" }));
    expect(window.location.pathname).toBe("/templates/contract.service.commercial.v1");
    expect(screen.getByRole("heading", { name: "商务服务合同" })).toBeVisible();
    expect(screen.getByText(/覆盖交付物、委托安排、数据、代理权限和任意解除/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "风险提示" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回合同模板" })).toBeVisible();
  });

  test("通用报价单动作进入已实现编辑器", async () => {
    const user = userEvent.setup();
    renderAt("/templates?category=报价单");

    await user.click(screen.getByRole("link", { name: "使用模板：标准货物报价单" }));
    expect(window.location.pathname).toBe("/editor/standard-goods-quote");
    expect(await screen.findByRole("heading", { name: "标准商品报价单" })).toBeVisible();
  });

  test("未知模板编号显示诚实的不存在状态", () => {
    renderAt("/templates/not-a-template");

    expect(screen.getByRole("heading", { name: "模板不存在" })).toBeVisible();
    expect(screen.getByText(/未找到编号为 not-a-template 的模板/)).toBeVisible();
    expect(screen.getByRole("link", { name: "返回模板中心" })).toBeVisible();
  });
});

describe("报价单编辑器", () => {
  test("真实五步表单输入同步到统一 A4 文档预览", async () => {
    const user = userEvent.setup();
    renderAt("/editor/standard-goods-quote");

    const preview = await screen.findByRole("region", { name: "A4 报价单预览" });
    await user.clear(screen.getByRole("textbox", { name: "报价方名称" }));
    await user.type(screen.getByRole("textbox", { name: "报价方名称" }), "宁波远航贸易有限公司");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.clear(screen.getByRole("textbox", { name: "采购方名称" }));
    await user.type(screen.getByRole("textbox", { name: "采购方名称" }), "海湾采购集团");
    await user.click(screen.getByRole("button", { name: /商品明细/ }));
    const firstLineName = screen.getByLabelText("第 1 行商品名称");
    await user.clear(firstLineName);
    await user.type(firstLineName, "高效节能电机");

    expect(within(preview).getByText("宁波远航贸易有限公司")).toBeVisible();
    expect(within(preview).getByText("海湾采购集团")).toBeVisible();
    expect(within(preview).getByText("高效节能电机")).toBeVisible();
  });

  test("移动端可在填写和预览之间双向切换", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    renderAt("/editor/standard-goods-quote");

    const form = await screen.findByRole("region", { name: "报价单填写区" });
    const preview = screen.getByRole("region", { name: "A4 报价单预览" });
    const previewButton = screen.getByRole("button", { name: "查看文档预览" });
    expect(previewButton).toHaveAttribute("aria-pressed", "false");

    await user.click(previewButton);
    expect(screen.getByRole("button", { name: "返回填写" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(preview).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "返回填写" }));
    expect(screen.getByRole("button", { name: "查看文档预览" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(form).toHaveFocus();
  });

  test("桌面端保持三栏且不暴露移动端切换控件", async () => {
    renderAt("/editor/standard-goods-quote");

    expect(await screen.findByRole("complementary", { name: "报价单步骤" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "报价单填写区" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "A4 报价单预览" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看文档预览|返回填写/ })).not.toBeInTheDocument();
  });

  test("保存与下一步动作已真实开放", async () => {
    const user = userEvent.setup();
    renderAt("/editor/standard-goods-quote");

    const save = await screen.findByRole("button", { name: "保存草稿" });
    const next = screen.getByRole("button", { name: "下一步" });
    expect(save).toBeEnabled();
    expect(next).toBeEnabled();
    await user.click(next);
    expect(await screen.findByRole("heading", { name: "客户信息" })).toBeVisible();
  });
});

describe("V2 通用编辑器路由", () => {
  test.each(v2.TEMPLATE_IDS_V2)("%s 直达对应的 1.0.0 编辑器", async (templateId) => {
    renderAt(`/editor/${templateId}`);
    const definition = v2.V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0").definition;

    expect((await screen.findAllByRole("heading", { name: definition.name }))[0]).toBeVisible();
    expect(screen.getByText(`${templateId} · 1.0.0`)).toBeVisible();
  });

  test("未知 V2 模板不会回退到 V1 报价单", () => {
    renderAt("/editor/not-a-template");

    expect(screen.getByRole("heading", { name: "模板版本不存在" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "标准商品报价单" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回模板中心" })).toHaveAttribute(
      "href",
      "/templates",
    );
  });
});

describe("格式转换边界", () => {
  test("区分本地处理和服务器增强且服务器能力不会发起请求", async () => {
    renderAt("/convert");

    expect(screen.getByRole("heading", { name: "本地处理" })).toBeVisible();
    const localInput = screen.getByLabelText("选择本地转换文件");
    expect(localInput).toHaveAttribute("type", "file");
    expect(localInput).toHaveAttribute(
      "accept",
      ".txt,.md,.markdown,.html,.htm,.docx,.pdf,.png,.jpg,.jpeg,.webp,.avif",
    );
    expect(localInput.getAttribute("accept")?.split(",")).not.toEqual(
      expect.arrayContaining([".doc", ".xls", ".xlsx"]),
    );
    expect(
      screen.getByText("支持 TXT、Markdown、HTML、DOCX、PDF 与常用图片；具体操作按格式显示"),
    ).toBeVisible();
    expect(screen.getByText(/单个文件不超过 25 MiB/)).toBeVisible();
    expect(screen.getByText("文件不会离开您的设备")).toBeVisible();
    expect(screen.queryByText(/超大文件/)).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "服务器增强" })).toBeVisible();
    expect(
      screen.getByText("GitHub Pages 为本地功能预览；服务器转换仅在 opentrad.dns.army 开放。"),
    ).toBeVisible();
    expect(screen.queryByLabelText("选择服务器处理文件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
  });

  test("拒绝超过 25 MiB 的文件并接受合法文件", async () => {
    const user = userEvent.setup();
    renderAt("/convert");
    const localInput = screen.getByLabelText("选择本地转换文件");
    const oversizedFile = new File(["oversized"], "oversized.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(oversizedFile, "size", { value: 25 * 1024 * 1024 + 1 });

    await user.upload(localInput, oversizedFile);
    expect(screen.getByRole("alert")).toHaveTextContent("文件超过 25 MiB，请选择更小的文件");
    expect(localInput).toHaveValue("");
    expect(screen.queryByText("oversized.pdf")).not.toBeInTheDocument();

    const validFile = new File(["# Trade terms"], "terms.md", { type: "text/markdown" });
    await user.upload(localInput, validFile);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("terms.md")).toBeVisible();
    expect(screen.getByText("文件已在本机就绪")).toBeVisible();
  });
});
