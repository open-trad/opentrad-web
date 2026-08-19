# OpenTrad v1 Phase 2 Implementation Plan

**Goal:** 把标准货物报价单做成匿名、本地优先、可保存、可恢复、可导出的完整纵向切片。

**Architecture:** 在共享 `packages/document-core` 中定义模板、Zod schema、金额计算和统一 `DocumentModel`。Web 层通过 IndexedDB 保存公司档案与多个草稿，HTML 预览、DOCX 和 PDF 渲染器只消费同一个 `DocumentModel`。所有文件在浏览器生成，不调用后端或第三方 CDN。

**Visual/document baseline:** 继续使用已验收的“现代纸张商贸”概念 A；DOCX/PDF 使用正式商务报价单版式，命名覆盖 `opentrad_a4_quotation`：A4 纵向、克制墨蓝/矿物绿、明确表格几何、页脚和签署区。PDF 使用同源本地中文字体并嵌入。

---

## Task 1: 共享模板、schema、金额与 DocumentModel

- [ ] 建立 `@opentrad/document-core` workspace 包和独立 Vitest/typecheck/build。
- [ ] 定义 `TemplateDefinition`、`DocumentDraft`、`DocumentModel`、`Party`、`LineItem`、风险与项目包 envelope。
- [ ] 实现 `quotation.goods.standard.v1`，固定模板版本与依据日期 `2026-08-19`。
- [ ] 金额以最小货币单位整数字符串保存；数量使用受限十进制字符串；实现折扣、含税/未税/免税、逐行及汇总的确定性舍入。
- [ ] 编译标准报价单为标题、元数据、双方、明细表、合计、交付付款、检验质保、提示和签署区 AST。
- [ ] RED→GREEN 覆盖 schema、日期、金额、税额、折扣、浮点尾差、条款显隐、未知版本和序列化往返。

## Task 2: IndexedDB、本地项目与导出引擎

- [ ] 建立版本化 IndexedDB：公司档案、草稿、当前草稿指针；支持新增、列出、载入、自动保存、删除和一键清空。
- [ ] 实现 JSON 与 `.opentrad` envelope 导入/导出；导入时限制版本、深度、数组和文本长度，并重新计算派生金额。
- [ ] 实现 DOCX 渲染器：A4、明确字体/边距/表格列宽、重复表头、页脚、签署区和通用免责声明。
- [ ] 实现 pdfmake 渲染器：同一 `DocumentModel`、本地中文字体、可搜索文字、字体嵌入和无远程请求。
- [ ] 为下载文件使用安全文件名；失败时给出可恢复的中文错误，不记录文书正文或文件名。
- [ ] RED→GREEN 覆盖 IndexedDB 恢复、项目包校验、三种导出内容一致性和错误路径。

## Task 3: 标准报价单完整编辑器

- [ ] 将现有编辑器扩展为五步真实表单：基本信息、买方信息、商品明细、条款备注、审核导出。
- [ ] 支持多行商品增删、数量/单价/折扣/税率、币种、含税模式、有效期和报价性质。
- [ ] 公司档案可保存并一键带入；草稿状态显示“正在保存/已保存/保存失败”，刷新后恢复。
- [ ] 桌面保持步骤+表单+A4 预览；900px 下预览下排；手机保持填写/预览切换。
- [ ] 导出 DOCX、PDF、JSON、`.opentrad`；导入项目、草稿列表、新建/删除/清空均为真实交互。
- [ ] 所有控制提供可访问名称、键盘焦点、错误关联和离线/本地提示；无空按钮或虚假成功。
- [ ] RED→GREEN 覆盖填写、计算、自动保存、刷新恢复、导入导出和移动切换。

## Task 4: 文件与浏览器验收

- [ ] 在真实浏览器生成一份包含中文、两行商品、折扣和 13% 税率的金样 DOCX/PDF/JSON/`.opentrad`。
- [ ] DOCX 解包检查核心结构，并用 LibreOffice 渲染全部页面为 PNG；检查 Word/LibreOffice 无修复提示的可验证范围。
- [ ] PDF 使用 `pdfinfo`、`pdffonts`、`pdftotext` 与 Poppler PNG 检查 A4、字体嵌入、中文可搜索和无裁切。
- [ ] Browser/IAB 覆盖桌面、900px 和手机：新建、自动保存、刷新恢复、导出、导入、删除和清空。
- [ ] 对照概念 A 与最新截图完成至少五项 fidelity ledger，首屏文案无漂移。

## Task 5: 质量门禁、复审与部署

- [ ] 全量运行 frozen install、audit、lint、typecheck、unit、build、Pages build、diff check。
- [ ] 每个实现任务完成规格复审，再完成代码质量复审；最终做全阶段审查。
- [ ] 推送 `main`，等待 CI/Pages 成功，线上复测下载与刷新恢复。
- [ ] 部署后停止，等待用户阶段 2 验收；不修改阿里云服务器、认证或服务器转换。
