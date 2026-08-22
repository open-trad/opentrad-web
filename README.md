# OpenTrad Web

OpenTrad 是面向商贸团队的中文开源单证工具门户。它在浏览器中提供本地优先的模板编辑、预览和导出，外贸文档支持中英双语。本项目不是政府、采购平台或其他官方机构的产品。

## 当前能力

- 15 个正式模板，覆盖报价单、形式发票、合同与投标文件。
- 三种版式、中文与中英双语预览，以及 DOCX、PDF、JSON 和 `.opentrad` 项目包导出。
- 草稿自动保存在当前浏览器；本阶段的文档和附件均留在本机，不上传服务器。
- 完全不使用 AI，也不依赖付费服务。

## 模板清单

1. 标准货物报价单（`quotation.goods.standard.v1`）
2. 项目服务报价单（`quotation.service.project.v1`）
3. OEM 定制报价单（`quotation.oem.custom.v1`）
4. 中英双语出口报价单（`quotation.export.bilingual.v1`）
5. 形式发票（`quotation.proforma.invoice.v1`）
6. 国内货物销售合同（`contract.sale.domestic-b2b.v1`）
7. 框架供应合同（`contract.supply.framework.v1`）
8. OEM加工合同（`contract.oem.processing.v1`）
9. 商务服务合同（`contract.service.commercial.v1`）
10. 国际货物销售合同（中英双语）（`contract.sale.international-bilingual.v1`）
11. 政府采购货物投标文件（`bid.government.goods.v1`）
12. 政府采购服务投标文件（`bid.government.services.v1`）
13. 建设工程施工投标文件（`bid.construction.works.v1`）
14. 企业货物采购投标文件（`bid.enterprise.goods.v1`）
15. 企业服务采购建议书（`bid.enterprise.services.v1`）

## 项目兼容性

V1 的标准货物报价单项目格式保持可读、可编译和可导出。V2 项目使用带模板版本的 `ProjectEnvelopeV2`，支持其余 14 个模板、附件和 `.opentrad` ZIP 项目包。导入时按项目内的模板 ID 与版本解析；既有 V1 草稿不会被静默升级或改写为 V2。

## 使用边界

模板与校验仅提供文档起草辅助，不构成法律、税务、报关、招投标或其他专业意见，也不保证文件合规、交易成功或投标中标。OpenTrad 不判断税率或 HS 编码，不提供万能标书、电子签名、开票、报关、自动投标，也不承诺 PDF 与 Office 之间的高保真双向转换。法律、税务或采购规则变化时应发布新模板版本；已有草稿不会被静默修改。重要文件请由具备资质的专业人士结合最新规则复核。

## 本地开发

环境要求：Node.js 24 或更高版本，pnpm 10。金样验证还需要 Fontconfig（`fc-cache`）、`xmllint`、LibreOffice（`soffice`）和 Poppler（`pdfinfo`、`pdffonts`、`pdftotext`、`pdftoppm`）。

macOS 可使用 Homebrew 安装：

```bash
brew install fontconfig poppler
brew install --cask libreoffice
```

macOS 系统自带 `xmllint`。Ubuntu/Debian 可使用：

```bash
sudo apt-get update
sudo apt-get install --yes fontconfig libxml2-utils libreoffice-writer poppler-utils
```

```bash
pnpm install
pnpm --filter @opentrad/web exec playwright install chromium
pnpm dev
```

Vite 默认在终端显示本地访问地址。常用质量命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm golds:verify
pnpm e2e
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
