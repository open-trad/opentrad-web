# OpenTrad Web

OpenTrad 是面向全球贸易团队的开源商贸单证工具包。本仓库提供“现代纸张商贸”风格的可交互 Web 基础，覆盖工具首页、模板中心、报价单编辑器与格式转换边界展示。

## 当前能力

- 首页提供格式转换、报价单、合同和标书四个真实路由入口。
- 模板中心包含八种示意模板，支持分类、版式和关键词筛选。
- 报价单编辑器提供步骤导航、表单输入和实时 A4 预览。
- 格式转换页明确区分本地处理与需要登录的服务器增强能力。
- 本地优先：当前版本不接入后端，服务器增强按钮不会上传文件或发起网络请求。

## 本地开发

环境要求：Node.js 24 或更高版本，pnpm 10。

```bash
pnpm install
pnpm dev
```

Vite 默认在终端显示本地访问地址。常用质量命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 工程结构

```text
apps/web/                         React Web 应用
docs/design/                      已接受概念图与设计系统
docs/superpowers/plans/           实施计划
.github/workflows/                CI 与 GitHub Pages 部署流程
```

## GitHub Pages

Pages 工作流通过 `VITE_BASE_PATH=/opentrad-web/` 构建静态站点。本地开发的 base 保持 `/`，无需更改代码。

## 许可

本项目使用 GNU Affero General Public License v3.0，完整条款见 [LICENSE](./LICENSE)。
