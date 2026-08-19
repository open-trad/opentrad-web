import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import App from "./App";

const renderAt = (path = "/") => {
  window.history.pushState({}, "", path);
  return render(<App />);
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("首页导航与工具入口", () => {
  test("展示品牌、核心导航和四个可访问入口", () => {
    renderAt();

    expect(screen.getByRole("heading", { name: "专业的开源商贸单证工具包" })).toBeVisible();
    expect(screen.getByText("从创建、编辑到转换，满足您的全球贸易文档需求")).toBeVisible();
    expect(screen.getByRole("link", { name: /OpenTrad 开源商贸/ })).toBeVisible();

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
});

describe("模板中心", () => {
  test("分类和搜索会真实筛选模板卡片", async () => {
    const user = userEvent.setup();
    renderAt("/templates");

    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: /报价单/ }));
    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(2);
    expect(screen.getByText("通用报价单")).toBeVisible();
    expect(screen.queryByText("技术标书模板")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "搜索模板" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索模板" }), "跨境");
    expect(screen.getAllByRole("link", { name: /使用模板/ })).toHaveLength(1);
    expect(screen.getByText("跨境商品报价单")).toBeVisible();
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
});

describe("格式转换边界", () => {
  test("区分本地处理和服务器增强且服务器能力不会发起请求", async () => {
    const user = userEvent.setup();
    renderAt("/convert");

    expect(screen.getByRole("heading", { name: "本地处理" })).toBeVisible();
    expect(screen.getByLabelText("选择本地转换文件")).toHaveAttribute("type", "file");
    expect(screen.getByText("文件不会离开您的设备")).toBeVisible();

    expect(screen.getByRole("heading", { name: "服务器增强" })).toBeVisible();
    const serverButton = screen.getByRole("button", { name: /需登录/ });
    expect(serverButton).toBeDisabled();
    await user.click(serverButton);
    expect(screen.getByText("登录后可用；当前不会上传文件或发起网络请求")).toBeVisible();
  });
});
