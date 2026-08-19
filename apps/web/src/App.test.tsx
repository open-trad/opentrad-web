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
    expect(within(brand).getByRole("img", { name: "OpenTrad 组织头像" })).toHaveAttribute(
      "src",
      "/brand/open-trad.png",
    );
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
    expect(screen.getByRole("heading", { name: "标准商品报价单" })).toBeVisible();
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

    expect(screen.getByText("专业的商贸单证模板，支持分类浏览与开放状态说明")).toBeVisible();
    expect(screen.getAllByRole("link", { name: /使用模板|查看说明/ })).toHaveLength(8);
    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /查看说明/ })).toHaveLength(7);
    await user.click(screen.getByRole("button", { name: /报价单/ }));
    expect(new URLSearchParams(window.location.search).get("category")).toBe("报价单");
    expect(screen.getAllByRole("link", { name: /使用模板|查看说明/ })).toHaveLength(2);
    expect(screen.getByText("通用报价单")).toBeVisible();
    expect(screen.queryByText("技术标书模板")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "搜索模板" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索模板" }), "跨境");
    expect(screen.getAllByRole("link", { name: /使用模板|查看说明/ })).toHaveLength(1);
    expect(screen.getByText("跨境商品报价单")).toBeVisible();
  });

  test("首页合同入口按 URL 筛选并进入真实模板说明", async () => {
    const user = userEvent.setup();
    renderAt();

    const coreTools = screen.getByRole("region", { name: "核心工具" });
    await user.click(within(coreTools).getByRole("link", { name: /合同/ }));
    expect(window.location.pathname).toBe("/templates");
    expect(new URLSearchParams(window.location.search).get("category")).toBe("合同");
    expect(screen.getAllByRole("link", { name: /查看说明/ })).toHaveLength(2);
    expect(screen.getByText("国际销售合同")).toBeVisible();
    expect(screen.getByText("服务合同模板")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "查看说明：国际销售合同" }));
    expect(window.location.pathname).toBe("/templates/sales-contract");
    expect(screen.getByRole("heading", { name: "国际销售合同" })).toBeVisible();
    expect(screen.getByText("面向国际货物销售的标准条款结构。")).toBeVisible();
    expect(screen.getByText(/第二阶段开放编辑/)).toBeVisible();
    expect(screen.getByRole("link", { name: "返回合同模板" })).toBeVisible();
  });

  test("通用报价单动作进入已实现编辑器", async () => {
    const user = userEvent.setup();
    renderAt("/templates?category=报价单");

    await user.click(screen.getByRole("link", { name: "使用模板：通用报价单" }));
    expect(window.location.pathname).toBe("/editor/standard-goods-quote");
    expect(screen.getByRole("heading", { name: "标准商品报价单" })).toBeVisible();
  });

  test("未知模板编号显示诚实的不存在状态", () => {
    renderAt("/templates/not-a-template");

    expect(screen.getByRole("heading", { name: "模板不存在" })).toBeVisible();
    expect(screen.getByText(/未找到对应的模板说明/)).toBeVisible();
    expect(screen.getByRole("link", { name: "返回模板中心" })).toBeVisible();
  });
});

describe("报价单编辑器", () => {
  test("表单输入实时同步到 A4 文档预览", async () => {
    const user = userEvent.setup();
    renderAt("/editor/standard-goods-quote");

    const preview = screen.getByRole("region", { name: "A4 报价单预览" });
    await user.clear(screen.getByLabelText("公司名称"));
    await user.type(screen.getByLabelText("公司名称"), "宁波远航贸易有限公司");
    await user.clear(screen.getByLabelText("客户名称"));
    await user.type(screen.getByLabelText("客户名称"), "海湾采购集团");
    await user.clear(screen.getByLabelText("产品名称"));
    await user.type(screen.getByLabelText("产品名称"), "高效节能电机");

    expect(within(preview).getAllByText("宁波远航贸易有限公司")).toHaveLength(2);
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

    const form = screen.getByRole("region", { name: "报价单基本信息" });
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

  test("桌面端保持三栏且不暴露移动端切换控件", () => {
    renderAt("/editor/standard-goods-quote");

    expect(screen.getByRole("complementary", { name: "报价单步骤" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "报价单基本信息" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "A4 报价单预览" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看文档预览|返回填写/ })).not.toBeInTheDocument();
  });

  test("未开放的编辑动作明确禁用", () => {
    renderAt("/editor/standard-goods-quote");

    for (const label of [/保存草稿.*第二阶段开放/, /下一步.*第二阶段开放/]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringMatching(/第二阶段开放/));
    }
  });
});

describe("格式转换边界", () => {
  test("区分本地处理和服务器增强且服务器能力不会发起请求", async () => {
    const user = userEvent.setup();
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
    const serverButton = screen.getByRole("button", { name: /需登录/ });
    expect(serverButton).toBeDisabled();
    await user.click(serverButton);
    expect(screen.getByText("登录后可用；当前不会上传文件或发起网络请求")).toBeVisible();
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
