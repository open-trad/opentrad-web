# OpenTrad Templates V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变任何 OpenTrad V1 草稿或项目包语义的前提下，交付其余 14 个首发报价、合同和标书模板、三套版式、统一 HTML/DOCX/PDF 渲染、版本化本地项目包以及可在模板中心完整使用的本地编辑流程。

**Architecture:** 保留 `quotation.goods.standard.v1@1.0.0`、现有 `DocumentDraftSchema`、`DocumentModelSchema` 和 `ProjectEnvelopeV1` 为不可变兼容层；新能力通过精确 `templateId@templateVersion` 注册表、`ProjectEnvelopeV2`、`DocumentModelV2` 和独立渲染适配层加入。模板编译只产生语义 AST，版式只影响呈现；标书以招标文件版本为锚点，缺失锚点时只能生成带强制水印的内部底稿。

**Tech Stack:** Node.js 24、pnpm 10、TypeScript 5.9、Zod 4、React 19、Vite 7、Vitest 3、Testing Library、IndexedDB/idb、docx 9、pdfmake 0.3、fflate、Source Han Sans CN、LibreOffice、Poppler、Playwright。

---

## Scope and execution checkpoints

本计划包含四个依赖同一版本主干的子系统，因此保留在同一主计划中，但必须在以下检查点分别形成可运行提交：

1. Compatibility core：Tasks 1–4，旧 V1 全部测试继续通过。
2. Presentation/rendering：Tasks 5–8，合成 V2 文档可在 HTML、DOCX、PDF 中一致输出。
3. Template definitions：Tasks 9–14，14 个模板逐批加入注册表，每批可单独回滚。
4. Product integration：Tasks 15–18，本地附件、项目包、模板中心、编辑器、金样和全量门禁。

任何检查点失败时不得继续下一个检查点。现有报价编辑器、现有 `.opentrad` V1、GitHub Pages 路由和下载行为都是回归基线。

## Primary source catalogue

模板只抽取结构和风险点，不复制官方标识、封面或大段条款。每个 `TemplateDefinitionV2` 的 `basisDate` 固定为 `2026-08-19`，并记录以下一手来源：

- 全国合同示范文本库使用说明：<https://htsfwb.samr.gov.cn/>
- 市场监管总局 GF—2025—1001 委托合同：<https://htsfwb.samr.gov.cn/View?id=50b57729-0fca-45d2-92c3-fe7e6a989815>
- 《中华人民共和国民法典》全国人大法律文本：<https://wb.flk.npc.gov.cn/flfg/PDF/bd53dd912c1048f2aecbaa229238334b.pdf>
- 财政部令第 87 号：<https://tfs.mof.gov.cn/caizhengbuling/201707/t20170718_2652603.htm>
- 财政部《政府采购需求管理办法》：<https://www.mof.gov.cn/gkml/caizhengwengao/wg2021/wg202005/202109/t20210917_3753625.htm>
- 《中华人民共和国招标投标法》：<https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_1f79dd79321441a0831f3aed697b4535.html>
- 国家发展改革委标准施工招标文件通知：<https://zfxxgk.ndrc.gov.cn/upload/images/202210/20221091765984.pdf>
- 国家发展改革委《招标人主体责任履行指引》：<https://www.ndrc.gov.cn/xxgk/zcfb/tz/202511/t20251111_1401536_ext.html>
- ICC Incoterms® 2020 公共指引：<https://library.iccwbo.org/clp/clp-incoterms-qa-2020.htm?AGENT=ICC_HQ>
- 美国商务部 Pro Forma Invoice 指南：<https://www.trade.gov/pro-forma-invoice>
- UNCITRAL CISG 官方说明：<https://uncitral.un.org/en/texts/salegoods/conventions/sale_of_goods/cisg>

## File map

### Immutable compatibility surface

- Keep behavior unchanged: `packages/document-core/src/schemas.ts` — V1 template, draft, AST and project schemas.
- Keep behavior unchanged: `packages/document-core/src/compiler.ts` — V1 standard-goods compiler.
- Keep behavior unchanged: `packages/document-core/src/project.ts` — V1 project serialization/parsing.
- Test: `packages/document-core/tests/v1-compatibility.test.ts` — frozen public values, semantic digest and V1 round-trip.

### V2 core

- Create: `packages/document-core/src/v2/source-basis.ts` — frozen official source descriptors.
- Create: `packages/document-core/src/v2/common.ts` — localized text, parties, shared metadata and bounded schemas.
- Create: `packages/document-core/src/v2/registry.ts` — exact template-version registry and dispatch API.
- Create: `packages/document-core/src/v2/project.ts` — ProjectEnvelopeV2 and V1/V2 dispatch.
- Create: `packages/document-core/src/v2/document-model.ts` — DocumentModelV2 and block schemas.
- Create: `packages/document-core/src/v2/risk.ts` — preflight findings and export impact.
- Create: `packages/document-core/src/v2/presentation.ts` — three immutable presentation profiles.
- Create: `packages/document-core/src/v2/index.ts` — V2 exports.
- Modify: `packages/document-core/src/index.ts` — re-export V2 without renaming V1 exports.
- Test: `packages/document-core/tests/v2-registry.test.ts`.
- Test: `packages/document-core/tests/project-v2.test.ts`.
- Test: `packages/document-core/tests/document-model-v2.test.ts`.
- Test: `packages/document-core/tests/presentation-v2.test.ts`.

### Template definitions

- Create: `packages/document-core/src/v2/templates/quote-common.ts`.
- Create: `packages/document-core/src/v2/money.ts` — generic exact-decimal V2 line and summary calculation.
- Create: `packages/document-core/src/v2/templates/quotes/service-project.ts`.
- Create: `packages/document-core/src/v2/templates/quotes/oem-custom.ts`.
- Create: `packages/document-core/src/v2/templates/quotes/export-bilingual.ts`.
- Create: `packages/document-core/src/v2/templates/quotes/proforma-invoice.ts`.
- Create: `packages/document-core/src/v2/templates/contract-common.ts`.
- Create: `packages/document-core/src/v2/templates/contracts/domestic-sale.ts`.
- Create: `packages/document-core/src/v2/templates/contracts/framework-supply.ts`.
- Create: `packages/document-core/src/v2/templates/contracts/oem-processing.ts`.
- Create: `packages/document-core/src/v2/templates/contracts/commercial-service.ts`.
- Create: `packages/document-core/src/v2/templates/contracts/international-sale.ts`.
- Create: `packages/document-core/src/v2/templates/bid-common.ts`.
- Create: `packages/document-core/src/v2/templates/bids/government-goods.ts`.
- Create: `packages/document-core/src/v2/templates/bids/government-services.ts`.
- Create: `packages/document-core/src/v2/templates/bids/construction-works.ts`.
- Create: `packages/document-core/src/v2/templates/bids/enterprise-goods.ts`.
- Create: `packages/document-core/src/v2/templates/bids/enterprise-services.ts`.
- Create: `packages/document-core/src/v2/templates/index.ts` — registers all 14 new versions exactly once.
- Test: `packages/document-core/tests/quote-templates-v2.test.ts`.
- Test: `packages/document-core/tests/quote-common-v2.test.ts`.
- Test: `packages/document-core/tests/contract-templates-v2.test.ts`.
- Test: `packages/document-core/tests/bid-templates-v2.test.ts`.
- Test: `packages/document-core/tests/template-compiler-golds.test.ts`.

### Generic renderers

- Create: `apps/web/src/features/documents/render/normalizeModel.ts` — V1/V2 normalization.
- Create: `apps/web/src/features/documents/render/html/DocumentHtml.tsx` — semantic HTML preview.
- Create: `apps/web/src/features/documents/render/docx/buildDocxPlan.ts`.
- Create: `apps/web/src/features/documents/render/docx/renderDocxV2.ts`.
- Create: `apps/web/src/features/documents/render/pdf/buildPdfDefinitionV2.ts`.
- Create: `apps/web/src/features/documents/render/pdf/renderPdfV2.ts`.
- Create: `apps/web/src/features/documents/render/index.ts`.
- Test: `apps/web/src/features/documents/render/normalizeModel.test.ts`.
- Test: `apps/web/src/features/documents/render/html/DocumentHtml.test.tsx`.
- Test: `apps/web/src/features/documents/render/docx/renderDocxV2.test.ts`.
- Test: `apps/web/src/features/documents/render/pdf/renderPdfV2.test.ts`.
- Test: `apps/web/src/features/documents/render/renderParityV2.test.ts`.
- Test helper: `apps/web/src/features/documents/render/testFixtures.ts` — one bounded V2 model containing every block kind.

### Local storage and package files

- Create: `apps/web/src/features/documents/storage/documentRepository.ts` — V1/V2 drafts and attachment records.
- Create: `apps/web/src/features/documents/storage/attachmentValidation.ts` — count, size and MIME enforcement.
- Create: `apps/web/src/features/documents/project/projectV2Files.ts` — ZIP package import/export.
- Modify: `apps/web/src/features/quotation/storage/repository.ts` — database version 2 upgrade only; retain V1 API.
- Modify: `apps/web/package.json` — add exact `fflate` dependency.
- Test: `apps/web/src/features/documents/storage/documentRepository.test.ts`.
- Test: `apps/web/src/features/documents/storage/attachmentValidation.test.ts`.
- Test: `apps/web/src/features/documents/project/projectV2Files.test.ts`.

### Template centre and editors

- Modify: `apps/web/src/data/templates.ts` — replace preview-only catalogue with 15 registered templates.
- Modify: `apps/web/src/pages/TemplatesPage.tsx` — category, language, risk and availability filters.
- Modify: `apps/web/src/pages/TemplateDetailPage.tsx` — sources, version, basis date and risk notice.
- Create: `apps/web/src/features/documents/editor/DocumentEditorPage.tsx`.
- Create: `apps/web/src/features/documents/editor/SchemaForm.tsx`.
- Create: `apps/web/src/features/documents/editor/DocumentPreviewPanel.tsx`.
- Create: `apps/web/src/features/documents/editor/ExportPanel.tsx`.
- Create: `apps/web/src/features/documents/editor/BidPreflightPanel.tsx`.
- Create: `apps/web/src/features/documents/editor/fieldPaths.ts` — safe manifest-driven immutable draft updates.
- Modify: `apps/web/src/App.tsx` — generic `/editor/:templateId` route while retaining the V1 route.
- Modify: `apps/web/src/styles.css` — V2 form, bilingual, long-document and print styles.
- Test: `apps/web/src/pages/TemplatesPage.test.tsx`.
- Test: `apps/web/src/pages/TemplateDetailPage.test.tsx`.
- Test: `apps/web/src/features/documents/editor/DocumentEditorPage.test.tsx`.
- Test: `apps/web/src/features/documents/editor/BidPreflightPanel.test.tsx`.

### Golds, browser checks and documentation

- Create: `packages/document-core/tests/fixtures/v2/*.json` — one full and one conditional fixture per new template.
- Create: `tests/golds/templates-v2/manifest.json` — expected artifact metadata for all 15 templates.
- Create: `scripts/generate-template-golds.mjs` — deterministic browser artifact generation.
- Create: `scripts/verify-template-golds.mjs` — DOCX/XML, PDF/font/text and semantic checks.
- Create: `apps/web/e2e/templates-v2.spec.ts` — desktop/mobile template and export flows.
- Modify: `README.md` — 15 templates, local-data boundary and non-advice statements.
- Modify: `.github/workflows/ci.yml` — run template gold structure checks and E2E.

---

### Task 1: Freeze the V1 compatibility contract

**Files:**
- Create: `packages/document-core/tests/v1-compatibility.test.ts`
- Read without modification: `packages/document-core/src/schemas.ts`
- Read without modification: `packages/document-core/src/compiler.ts`
- Read without modification: `packages/document-core/src/project.ts`

- [ ] **Step 1: Write a failing compatibility test before adding V2 exports**

```ts
import { describe, expect, it } from "vitest";
import {
  STANDARD_GOODS_QUOTE_TEMPLATE,
  compileStandardGoodsQuote,
  createStandardGoodsQuoteDraft,
  parseProject,
  serializeProject,
} from "../src/index";

describe("immutable V1 compatibility surface", () => {
  it("keeps exact identity, AST order and project format", () => {
    const draft = createStandardGoodsQuoteDraft({
      id: "compat-v1",
      now: "2026-08-19T00:00:00.000Z",
    });
    const model = compileStandardGoodsQuote(draft);
    const project = parseProject(serializeProject(draft));

    expect(STANDARD_GOODS_QUOTE_TEMPLATE).toEqual({
      id: "quotation.goods.standard.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
      category: "quotation",
      name: "标准货物报价单",
      supportedCurrencies: ["CNY", "USD", "EUR"],
    });
    expect(model.schemaVersion).toBe("1.0.0");
    expect(model.nodes.map((node) => node.id)).toEqual([
      "title",
      "quotation-meta",
      "parties",
      "line-items",
      "totals",
      "notice",
      "signature",
    ]);
    expect(project.formatVersion).toBe("1.0.0");
    expect(project.draft).toEqual(draft);
  });
});
```

- [ ] **Step 2: Run the compatibility test and record the baseline**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/v1-compatibility.test.ts`

Expected: PASS with `1 passed`; this is a characterization test, so its first run is GREEN. Save the terminal output in the task notes before any V2 edit.

- [ ] **Step 3: Run all existing core tests**

Run: `pnpm --filter @opentrad/document-core test`

Expected: PASS with no changed snapshots and no unknown-version acceptance.

- [ ] **Step 4: Commit the compatibility guard**

```bash
git add packages/document-core/tests/v1-compatibility.test.ts
git commit -m "test: freeze document v1 compatibility"
```

### Task 2: Add bounded V2 common types and the exact-version registry

**Files:**
- Create: `packages/document-core/src/v2/source-basis.ts`
- Create: `packages/document-core/src/v2/common.ts`
- Create: `packages/document-core/src/v2/registry.ts`
- Create: `packages/document-core/src/v2/index.ts`
- Modify: `packages/document-core/src/index.ts`
- Test: `packages/document-core/tests/v2-registry.test.ts`

- [ ] **Step 1: Write the registry RED test**

```ts
import { describe, expect, it } from "vitest";
import {
  createTemplateRegistry,
  type TemplateRegistration,
} from "../src/v2/index";

const registration: TemplateRegistration<{ templateId: string; templateVersion: string }> = {
  definition: {
    id: "quotation.service.project.v1",
    version: "1.0.0",
    category: "quotation",
    name: "项目/服务报价单",
    summary: "按服务项、里程碑和验收节点报价",
    basisDate: "2026-08-19",
    languages: ["zh-CN"],
    defaultLanguage: "zh-CN",
    allowedLayouts: ["classic-formal.v1", "modern-business.v1"],
    defaultLayout: "modern-business.v1",
    supportedOutputs: ["docx", "pdf", "json", "opentrad"],
    sourceKeys: ["samr-contract-library"],
    disclaimerProfile: "quotation",
    fieldManifest: [],
  },
  parseDraft: (value) => value as { templateId: string; templateVersion: string },
  createDraft: () => ({
    templateId: "quotation.service.project.v1",
    templateVersion: "1.0.0",
  }),
  compile: () => ({ schemaVersion: "2.0.0" }),
  preflight: () => [],
};

describe("V2 template registry", () => {
  it("dispatches exact id and version and rejects duplicate keys", () => {
    const registry = createTemplateRegistry([registration]);
    expect(registry.get("quotation.service.project.v1", "1.0.0")).toBe(registration);
    expect(() => registry.get("quotation.service.project.v1", "1.0.1")).toThrow(
      "不支持的模板版本",
    );
    expect(() => createTemplateRegistry([registration, registration])).toThrow(
      "模板版本重复注册",
    );
  });
});
```

- [ ] **Step 2: Run the registry test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/v2-registry.test.ts`

Expected: FAIL with `Cannot find module '../src/v2/index'`.

- [ ] **Step 3: Add the concrete V2 interfaces**

```ts
export type TemplateCategoryV2 = "quotation" | "contract" | "bid";
export type DocumentLanguageV2 = "zh-CN" | "en-US" | "zh-en";
export type LayoutStyleId =
  | "classic-formal.v1"
  | "modern-business.v1"
  | "international-compact.v1";
export type SupportedOutputV2 = "docx" | "pdf" | "json" | "opentrad";

export interface LocalizedText {
  zhCN: string;
  enUS?: string;
}

export interface TemplateFieldManifestEntryV1 {
  path: string;
  section: string;
  label: string;
  control:
    | "text"
    | "textarea"
    | "date"
    | "datetime"
    | "number"
    | "money"
    | "percent"
    | "select"
    | "checkbox"
    | "repeatable"
    | "attachment";
  required: boolean;
  options?: readonly { value: string; label: string }[];
  visibleWhen?: { path: string; equals: string | boolean };
}

export interface TemplateDefinitionV2 {
  id: string;
  version: string;
  category: TemplateCategoryV2;
  name: string;
  summary: string;
  basisDate: "2026-08-19";
  languages: readonly DocumentLanguageV2[];
  defaultLanguage: DocumentLanguageV2;
  allowedLayouts: readonly LayoutStyleId[];
  defaultLayout: LayoutStyleId;
  supportedOutputs: readonly SupportedOutputV2[];
  sourceKeys: readonly OfficialSourceKey[];
  disclaimerProfile: "quotation" | "contract" | "international" | "bid";
  fieldManifest: readonly TemplateFieldManifestEntryV1[];
}

export interface EntityPartyV2 {
  legalName: string;
  englishName?: string;
  entityType: "company" | "organization" | "individual";
  registrationId?: string;
  taxId?: string;
  registeredAddress?: string;
  postalAddress?: string;
  legalRepresentative?: string;
  authorizedRepresentative?: string;
  contactName: string;
  phone?: string;
  email?: string;
  bankAccountName?: string;
  bankName?: string;
  bankAccount?: string;
  swiftCode?: string;
}
```

Define strict Zod schemas beside these interfaces using the existing `isolatedObjectSchema`, `boundedCompositeSchema`, XML-safe text rules, maximum 100-element arrays and maximum 10,000-character clause text. Do not weaken the V1 guards.

- [ ] **Step 4: Add the official source constants**

```ts
export const OFFICIAL_SOURCES = Object.freeze({
  "samr-contract-library": {
    authority: "国家市场监督管理总局",
    title: "全国合同示范文本库",
    url: "https://htsfwb.samr.gov.cn/",
    reviewedAt: "2026-08-19",
  },
  "samr-entrustment-2025": {
    authority: "国家市场监督管理总局",
    title: "委托合同（GF—2025—1001）",
    url: "https://htsfwb.samr.gov.cn/View?id=50b57729-0fca-45d2-92c3-fe7e6a989815",
    reviewedAt: "2026-08-19",
  },
  "prc-civil-code": {
    authority: "全国人民代表大会",
    title: "中华人民共和国民法典",
    url: "https://wb.flk.npc.gov.cn/flfg/PDF/bd53dd912c1048f2aecbaa229238334b.pdf",
    reviewedAt: "2026-08-19",
  },
  "mof-order-87": {
    authority: "中华人民共和国财政部",
    title: "政府采购货物和服务招标投标管理办法",
    url: "https://tfs.mof.gov.cn/caizhengbuling/201707/t20170718_2652603.htm",
    reviewedAt: "2026-08-19",
  },
  "mof-demand-management": {
    authority: "中华人民共和国财政部",
    title: "政府采购需求管理办法",
    url: "https://www.mof.gov.cn/gkml/caizhengwengao/wg2021/wg202005/202109/t20210917_3753625.htm",
    reviewedAt: "2026-08-19",
  },
  "prc-tendering-law": {
    authority: "国家市场监督管理总局法规库",
    title: "中华人民共和国招标投标法",
    url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_1f79dd79321441a0831f3aed697b4535.html",
    reviewedAt: "2026-08-19",
  },
  "ndrc-standard-construction": {
    authority: "国家发展和改革委员会",
    title: "简明标准施工招标文件和标准设计施工总承包招标文件通知",
    url: "https://zfxxgk.ndrc.gov.cn/upload/images/202210/20221091765984.pdf",
    reviewedAt: "2026-08-19",
  },
  "ndrc-tenderer-responsibility": {
    authority: "国家发展和改革委员会",
    title: "招标人主体责任履行指引",
    url: "https://www.ndrc.gov.cn/xxgk/zcfb/tz/202511/t20251111_1401536_ext.html",
    reviewedAt: "2026-08-19",
  },
  "icc-incoterms-2020": {
    authority: "International Chamber of Commerce",
    title: "What the Incoterms 2020 rules do and do not do",
    url: "https://library.iccwbo.org/clp/clp-incoterms-qa-2020.htm?AGENT=ICC_HQ",
    reviewedAt: "2026-08-19",
  },
  "trade-gov-proforma": {
    authority: "International Trade Administration",
    title: "Pro Forma Invoice",
    url: "https://www.trade.gov/pro-forma-invoice",
    reviewedAt: "2026-08-19",
  },
  "uncitral-cisg": {
    authority: "UNCITRAL",
    title: "United Nations Convention on Contracts for the International Sale of Goods",
    url: "https://uncitral.un.org/en/texts/salegoods/conventions/sale_of_goods/cisg",
    reviewedAt: "2026-08-19",
  },
} as const);

export type OfficialSourceKey = keyof typeof OFFICIAL_SOURCES;
```

- [ ] **Step 5: Implement exact registry dispatch**

```ts
export interface TemplateRegistration<Draft = unknown, Model = unknown> {
  definition: TemplateDefinitionV2;
  parseDraft(value: unknown): Draft;
  createDraft(input: { id: string; now: string | Date }): Draft;
  compile(draft: Draft): Model;
  preflight(draft: Draft): readonly unknown[];
}

export function createTemplateRegistry(registrations: readonly TemplateRegistration[]) {
  const entries = new Map<string, TemplateRegistration>();
  for (const registration of registrations) {
    const key = `${registration.definition.id}@${registration.definition.version}`;
    if (entries.has(key)) throw new Error("模板版本重复注册");
    entries.set(key, registration);
  }
  return Object.freeze({
    get(templateId: string, templateVersion: string) {
      const registration = entries.get(`${templateId}@${templateVersion}`);
      if (!registration) throw new Error("不支持的模板版本");
      return registration;
    },
    list() {
      return Object.freeze(Array.from(entries.values()));
    },
  });
}
```

Task 4 changes `preflight` to return `readonly RiskFindingV2[]` after that type exists; no launch-template registration is added before Task 4.

- [ ] **Step 6: Run RED test to GREEN and run compatibility tests**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/v2-registry.test.ts tests/v1-compatibility.test.ts`

Expected: PASS with both files green; the V1 test output is byte-for-byte unchanged except test count.

- [ ] **Step 7: Commit registry foundation**

```bash
git add packages/document-core/src/v2 packages/document-core/src/index.ts packages/document-core/tests/v2-registry.test.ts
git commit -m "feat: add versioned template registry"
```

### Task 3: Add ProjectEnvelopeV2 without changing V1 project parsing

**Files:**
- Create: `packages/document-core/src/v2/project.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/project-v2.test.ts`

- [ ] **Step 1: Write ProjectEnvelopeV2 RED tests**

```ts
import { describe, expect, it } from "vitest";
import {
  parseOpenTradProject,
  serializeProjectV2,
  type ProjectEnvelopeV2,
} from "../src/v2/index";

const envelope: ProjectEnvelopeV2 = {
  formatVersion: "2.0.0",
  template: {
    id: "quotation.service.project.v1",
    version: "1.0.0",
    basisDate: "2026-08-19",
  },
  draft: {
    id: "service-quote-1",
    templateId: "quotation.service.project.v1",
    templateVersion: "1.0.0",
  },
  presentation: {
    layoutStyleId: "modern-business.v1",
    languageView: "zh-CN",
  },
  attachmentManifest: [],
};

describe("ProjectEnvelopeV2", () => {
  it("round-trips an exact registered version", () => {
    expect(parseOpenTradProject(serializeProjectV2(envelope))).toEqual(envelope);
  });

  it("rejects nested version mismatch", () => {
    expect(() =>
      serializeProjectV2({
        ...envelope,
        draft: { ...envelope.draft, templateVersion: "1.0.1" },
      }),
    ).toThrow("项目包模板版本不一致");
  });
});
```

- [ ] **Step 2: Run ProjectEnvelopeV2 test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/project-v2.test.ts`

Expected: FAIL because `parseOpenTradProject` and `serializeProjectV2` are not exported.

- [ ] **Step 3: Implement the V2 envelope and union parser**

```ts
export interface AttachmentRefV1 {
  id: string;
  category: "qualification" | "technical" | "commercial" | "other";
  displayName: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg";
  pageCount?: number;
  required: boolean;
  sourceRef?: string;
  localBlobKey?: string;
  status: "missing" | "attached" | "rejected";
  includedInSubmission: boolean;
}

export interface ProjectEnvelopeV2 {
  formatVersion: "2.0.0";
  template: { id: string; version: string; basisDate: "2026-08-19" };
  draft: { id: string; templateId: string; templateVersion: string } & Record<string, unknown>;
  presentation: { layoutStyleId: LayoutStyleId; languageView: DocumentLanguageV2 };
  attachmentManifest: AttachmentRefV1[];
}

export function serializeProjectV2(input: unknown): string {
  const envelope = ProjectEnvelopeV2Schema.parse(input);
  if (
    envelope.template.id !== envelope.draft.templateId ||
    envelope.template.version !== envelope.draft.templateVersion
  ) {
    throw new Error("项目包模板版本不一致");
  }
  return boundedStableJson(envelope, 1_048_576);
}

export function parseOpenTradProject(serialized: string) {
  const bounded = parseBoundedJson(serialized, 1_048_576);
  if (isObject(bounded) && bounded.formatVersion === "1.0.0") {
    return parseProject(serialized);
  }
  return ProjectEnvelopeV2Schema.parse(bounded);
}

function boundedStableJson(value: unknown, maximumBytes: number): string {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new Error("项目包超过 1 MiB");
  }
  return serialized;
}

function parseBoundedJson(serialized: string, maximumBytes: number): unknown {
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new Error("项目包超过 1 MiB");
  }
  return snapshotCompositeInput(JSON.parse(serialized));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
```

Use existing boundary helpers rather than a second recursive validator. `ProjectEnvelopeV2Schema` must reject unknown own keys, dangerous keys, more than 100 attachments, more than 12 levels, strings over 16,384 characters and mismatched template identity.

- [ ] **Step 4: Run V2 and V1 project tests**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/project-v2.test.ts tests/project.test.ts tests/v1-compatibility.test.ts`

Expected: PASS; V1 remains `formatVersion: "1.0.0"`, V2 remains `formatVersion: "2.0.0"`.

- [ ] **Step 5: Commit project V2**

```bash
git add packages/document-core/src/v2/project.ts packages/document-core/src/v2/index.ts packages/document-core/tests/project-v2.test.ts
git commit -m "feat: add opentrad project v2 envelope"
```

### Task 4: Add DocumentModelV2, risk findings and export impact

**Files:**
- Create: `packages/document-core/src/v2/document-model.ts`
- Create: `packages/document-core/src/v2/risk.ts`
- Modify: `packages/document-core/src/v2/registry.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/document-model-v2.test.ts`

- [ ] **Step 1: Write the DocumentModelV2 RED test**

```ts
import { describe, expect, it } from "vitest";
import { DocumentModelV2Schema, highestExportImpact } from "../src/v2/index";

describe("DocumentModelV2", () => {
  it("supports TOC, clauses, landscape sections and multi-party signatures", () => {
    const parsed = DocumentModelV2Schema.parse({
      schemaVersion: "2.0.0",
      documentId: "bid-1",
      template: {
        id: "bid.construction.works.v1",
        version: "1.0.0",
        basisDate: "2026-08-19",
      },
      documentKind: "bid",
      language: "zh-CN",
      title: { zhCN: "建设工程施工投标底稿" },
      pageDefaults: {
        size: "A4",
        orientation: "portrait",
        marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
      },
      sections: [
        { id: "toc", blocks: [{ type: "toc", id: "toc-block", maxDepth: 3 }] },
        {
          id: "price",
          page: { orientation: "landscape" },
          blocks: [{ type: "heading", id: "price-heading", level: 1, text: { zhCN: "报价" } }],
        },
        {
          id: "signature",
          blocks: [
            {
              type: "signatureGroup",
              id: "signature-block",
              signers: [
                { role: { zhCN: "投标人" }, name: "示例公司", dateLabel: { zhCN: "日期" } },
              ],
            },
          ],
        },
      ],
      watermarks: [],
      disclaimers: ["bid-authority"],
      attachmentManifest: [],
    });
    expect(parsed.sections[1]?.page?.orientation).toBe("landscape");
  });

  it("orders blockSubmission above watermark and advisory", () => {
    expect(highestExportImpact(["advisory", "watermark", "blockSubmission"])).toBe(
      "blockSubmission",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/document-model-v2.test.ts`

Expected: FAIL because `DocumentModelV2Schema` is missing.

- [ ] **Step 3: Implement the full V2 AST type contract**

```ts
interface BlockBaseV2 { id: string }
interface CoverBlockV2 extends BlockBaseV2 { type: "cover"; title: LocalizedText; subtitle?: LocalizedText }
interface HeadingBlockV2 extends BlockBaseV2 { type: "heading"; level: 1 | 2 | 3; text: LocalizedText }
interface ParagraphBlockV2 extends BlockBaseV2 { type: "paragraph"; text: LocalizedText }
interface KeyValueGridBlockV2 extends BlockBaseV2 { type: "keyValueGrid"; entries: Array<{ id: string; label: LocalizedText; value: LocalizedText }> }
interface PartiesBlockV2 extends BlockBaseV2 { type: "parties"; parties: Array<{ id: string; role: LocalizedText; name: LocalizedText; details: LocalizedText[] }> }
interface TableColumnV2 { id: string; label: LocalizedText; width: string; align: "left" | "center" | "right" }
interface TableRowV2 { id: string; cells: Record<string, LocalizedText> }
interface TableBlockV2 extends BlockBaseV2 { type: "table"; columns: TableColumnV2[]; rows: TableRowV2[]; repeatHeader: boolean; pagePolicy: { allowRowSplit: boolean; keepHeaderWithRows: number } }
interface TotalsBlockV2 extends BlockBaseV2 { type: "totals"; entries: Array<{ id: string; label: LocalizedText; value: LocalizedText }> }
interface ClauseGroupBlockV2 extends BlockBaseV2 { type: "clauseGroup"; title: LocalizedText; clauses: Array<{ id: string; number: string; title: LocalizedText; paragraphs: LocalizedText[] }> }
interface ListBlockV2 extends BlockBaseV2 { type: "list"; ordered: boolean; items: LocalizedText[] }
interface NoticeBlockV2 extends BlockBaseV2 { type: "notice"; tone: "info" | "warning" | "danger"; paragraphs: LocalizedText[] }
interface DeclarationBlockV2 extends BlockBaseV2 { type: "declaration"; title: LocalizedText; paragraphs: LocalizedText[] }
interface TocBlockV2 extends BlockBaseV2 { type: "toc"; maxDepth: 1 | 2 | 3 }
interface ComplianceMatrixBlockV2 extends BlockBaseV2 { type: "complianceMatrix"; columns: TableColumnV2[]; rows: Array<{ id: string; sourceRef: string; substantial: boolean; cells: Record<string, LocalizedText> }> }
interface AttachmentIndexBlockV2 extends BlockBaseV2 { type: "attachmentIndex"; attachmentIds: string[] }
interface AttachmentPageBlockV2 extends BlockBaseV2 { type: "attachmentPage"; attachmentId: string; pageNumber: number }
interface SignatureGroupBlockV2 extends BlockBaseV2 { type: "signatureGroup"; signers: Array<{ role: LocalizedText; name: string; dateLabel: LocalizedText; sealLabel?: LocalizedText }> }
interface PageBreakBlockV2 extends BlockBaseV2 { type: "pageBreak" }

export interface WatermarkPolicyV2 {
  id: string;
  text: LocalizedText;
  scope: "every-page" | "first-page";
}

export type DisclaimerRefV2 =
  | "quotation-non-advice"
  | "contract-generation-note"
  | "international-choice-warning"
  | "bid-authority";

export type DocumentBlockV2 =
  | CoverBlockV2
  | HeadingBlockV2
  | ParagraphBlockV2
  | KeyValueGridBlockV2
  | PartiesBlockV2
  | TableBlockV2
  | TotalsBlockV2
  | ClauseGroupBlockV2
  | ListBlockV2
  | NoticeBlockV2
  | DeclarationBlockV2
  | TocBlockV2
  | ComplianceMatrixBlockV2
  | AttachmentIndexBlockV2
  | AttachmentPageBlockV2
  | SignatureGroupBlockV2
  | PageBreakBlockV2;

export interface DocumentSectionV2 {
  id: string;
  page?: { orientation: "portrait" | "landscape" };
  blocks: DocumentBlockV2[];
}

export interface DocumentModelV2 {
  schemaVersion: "2.0.0";
  documentId: string;
  template: { id: string; version: string; basisDate: "2026-08-19" };
  documentKind: "quotation" | "contract" | "bid";
  language: DocumentLanguageV2;
  title: LocalizedText;
  pageDefaults: {
    size: "A4";
    orientation: "portrait";
    marginsMm: { top: number; right: number; bottom: number; left: number };
  };
  sections: DocumentSectionV2[];
  watermarks: WatermarkPolicyV2[];
  disclaimers: DisclaimerRefV2[];
  attachmentManifest: AttachmentRefV1[];
}
```

Every block schema must be a strict discriminated union member. Bound sections to 100, blocks per section to 100, table columns to 20, rows to 500, signers to 10 and localized text to 10,000 characters per language. `AttachmentPageBlockV2` may reference only an attachment ID; it must not contain a Blob or data URL.

- [ ] **Step 4: Implement risk and export impact**

```ts
export type ExportImpactV2 = "advisory" | "watermark" | "blockSubmission";

export interface RiskFindingV2 {
  code: string;
  severity: "info" | "warning" | "error";
  impact: ExportImpactV2;
  message: string;
  path?: string[];
}

const IMPACT_RANK: Record<ExportImpactV2, number> = {
  advisory: 0,
  watermark: 1,
  blockSubmission: 2,
};

export function highestExportImpact(impacts: readonly ExportImpactV2[]): ExportImpactV2 {
  return impacts.reduce(
    (highest, candidate) =>
      IMPACT_RANK[candidate] > IMPACT_RANK[highest] ? candidate : highest,
    "advisory",
  );
}
```

Update `TemplateRegistration.preflight` in `registry.ts` to return `readonly RiskFindingV2[]`. Type the concrete launch registry as registrations whose `compile` result is `DocumentModelV2`; the generic registry test from Task 2 remains valid.

- [ ] **Step 5: Run model, boundary and compatibility tests**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/document-model-v2.test.ts tests/boundaries.test.ts tests/v1-compatibility.test.ts`

Expected: PASS; invalid HTML, prototype keys, data URLs and more than 500 rows are rejected.

- [ ] **Step 6: Commit V2 document semantics**

```bash
git add packages/document-core/src/v2/document-model.ts packages/document-core/src/v2/risk.ts packages/document-core/src/v2/index.ts packages/document-core/tests/document-model-v2.test.ts
git commit -m "feat: add document model v2 and preflight risks"
```

### Task 5: Define three immutable presentation profiles

**Files:**
- Create: `packages/document-core/src/v2/presentation.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/presentation-v2.test.ts`

- [ ] **Step 1: Write presentation profile RED tests**

```ts
import { describe, expect, it } from "vitest";
import { getPresentationProfile, PRESENTATION_PROFILES } from "../src/v2/index";

describe("presentation profiles", () => {
  it("ships exactly three frozen profiles", () => {
    expect(Object.keys(PRESENTATION_PROFILES)).toEqual([
      "classic-formal.v1",
      "modern-business.v1",
      "international-compact.v1",
    ]);
    expect(getPresentationProfile("classic-formal.v1").defaultDocumentKinds).toContain("bid");
    expect(Object.isFrozen(PRESENTATION_PROFILES)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/presentation-v2.test.ts`

Expected: FAIL because the presentation exports do not exist.

- [ ] **Step 3: Implement concrete profile tokens**

```ts
export interface PresentationProfileV1 {
  id: LayoutStyleId;
  label: string;
  defaultDocumentKinds: readonly ("quotation" | "contract" | "bid")[];
  colors: { ink: string; accent: string; muted: string; paper: string; rule: string };
  typography: { bodyPt: number; smallPt: number; titlePt: number; headingPt: number };
  spacing: { blockAfterPt: number; paragraphAfterPt: number; cellPaddingPt: number };
  table: { headerFill: string; headerText: string; striped: boolean };
}

export const PRESENTATION_PROFILES = Object.freeze({
  "classic-formal.v1": Object.freeze({
    id: "classic-formal.v1",
    label: "经典正式",
    defaultDocumentKinds: ["contract", "bid"],
    colors: { ink: "#17201E", accent: "#203A35", muted: "#5E6965", paper: "#FFFFFF", rule: "#9AA5A0" },
    typography: { bodyPt: 10.5, smallPt: 8, titlePt: 20, headingPt: 13 },
    spacing: { blockAfterPt: 8, paragraphAfterPt: 5, cellPaddingPt: 4 },
    table: { headerFill: "#E6EBE8", headerText: "#17201E", striped: false },
  }),
  "modern-business.v1": Object.freeze({
    id: "modern-business.v1",
    label: "现代商务",
    defaultDocumentKinds: ["quotation"],
    colors: { ink: "#20312E", accent: "#285B50", muted: "#68726E", paper: "#FDFBF5", rule: "#B9C7C0" },
    typography: { bodyPt: 10, smallPt: 8, titlePt: 21, headingPt: 13 },
    spacing: { blockAfterPt: 9, paragraphAfterPt: 5, cellPaddingPt: 5 },
    table: { headerFill: "#285B50", headerText: "#FFFFFF", striped: true },
  }),
  "international-compact.v1": Object.freeze({
    id: "international-compact.v1",
    label: "国际简洁",
    defaultDocumentKinds: ["quotation", "contract"],
    colors: { ink: "#16272F", accent: "#235B6A", muted: "#65747A", paper: "#FFFFFF", rule: "#AAB8BD" },
    typography: { bodyPt: 9, smallPt: 7.5, titlePt: 18, headingPt: 11.5 },
    spacing: { blockAfterPt: 7, paragraphAfterPt: 4, cellPaddingPt: 3 },
    table: { headerFill: "#DDE9EC", headerText: "#16272F", striped: false },
  }),
} satisfies Record<LayoutStyleId, PresentationProfileV1>);
```

- [ ] **Step 4: Run the test and the formatter**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/presentation-v2.test.ts && pnpm lint`

Expected: PASS; Biome reports no mutable profile object and no formatting errors.

- [ ] **Step 5: Commit presentation profiles**

```bash
git add packages/document-core/src/v2/presentation.ts packages/document-core/src/v2/index.ts packages/document-core/tests/presentation-v2.test.ts
git commit -m "feat: add document presentation profiles"
```

### Task 6: Normalize V1/V2 and render every V2 block as semantic HTML

**Files:**
- Create: `apps/web/src/features/documents/render/testFixtures.ts`
- Create: `apps/web/src/features/documents/render/normalizeModel.ts`
- Create: `apps/web/src/features/documents/render/html/DocumentHtml.tsx`
- Create: `apps/web/src/features/documents/render/index.ts`
- Test: `apps/web/src/features/documents/render/normalizeModel.test.ts`
- Test: `apps/web/src/features/documents/render/html/DocumentHtml.test.tsx`

- [ ] **Step 1: Create a bounded fixture containing all V2 block types**

```ts
import type { DocumentModelV2 } from "@opentrad/document-core";

export function createEveryBlockModel(): DocumentModelV2 {
  return {
    schemaVersion: "2.0.0",
    documentId: "every-block",
    template: {
      id: "quotation.service.project.v1",
      version: "1.0.0",
      basisDate: "2026-08-19",
    },
    documentKind: "quotation",
    language: "zh-en",
    title: { zhCN: "服务报价", enUS: "SERVICE QUOTATION" },
    pageDefaults: {
      size: "A4",
      orientation: "portrait",
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    },
    sections: [
      {
        id: "all-blocks",
        blocks: [
          { type: "cover", id: "cover", title: { zhCN: "封面", enUS: "Cover" }, subtitle: { zhCN: "本地生成", enUS: "Generated locally" } },
          { type: "heading", id: "heading", level: 1, text: { zhCN: "第一章", enUS: "Chapter 1" } },
          { type: "paragraph", id: "paragraph", text: { zhCN: "正文", enUS: "Body" } },
          { type: "keyValueGrid", id: "grid", entries: [{ id: "number", label: { zhCN: "编号", enUS: "No." }, value: { zhCN: "Q-1", enUS: "Q-1" } }] },
          { type: "parties", id: "parties", parties: [{ id: "seller", role: { zhCN: "卖方", enUS: "Seller" }, name: { zhCN: "示例卖方", enUS: "Example Seller" }, details: [] }] },
          { type: "table", id: "table", columns: [{ id: "name", label: { zhCN: "名称", enUS: "Name" }, width: "100%", align: "left" }], rows: [{ id: "row-1", cells: { name: { zhCN: "服务", enUS: "Service" } } }], repeatHeader: true, pagePolicy: { allowRowSplit: false, keepHeaderWithRows: 1 } },
          { type: "totals", id: "totals", entries: [{ id: "total", label: { zhCN: "合计", enUS: "Total" }, value: { zhCN: "CNY 1.00", enUS: "CNY 1.00" } }] },
          { type: "clauseGroup", id: "clauses", title: { zhCN: "条款", enUS: "Terms" }, clauses: [{ id: "payment", number: "1", title: { zhCN: "付款", enUS: "Payment" }, paragraphs: [{ zhCN: "现付", enUS: "Pay now" }] }] },
          { type: "list", id: "list", ordered: true, items: [{ zhCN: "附件一", enUS: "Appendix 1" }] },
          { type: "notice", id: "notice", tone: "warning", paragraphs: [{ zhCN: "请审阅", enUS: "Review required" }] },
          { type: "declaration", id: "declaration", title: { zhCN: "声明", enUS: "Declaration" }, paragraphs: [{ zhCN: "内容真实", enUS: "Information is true" }] },
          { type: "toc", id: "toc", maxDepth: 3 },
          { type: "complianceMatrix", id: "matrix", columns: [{ id: "response", label: { zhCN: "响应", enUS: "Response" }, width: "100%", align: "left" }], rows: [{ id: "requirement-1", sourceRef: "3.1", substantial: true, cells: { response: { zhCN: "满足", enUS: "Comply" } } }] },
          { type: "attachmentIndex", id: "attachment-index", attachmentIds: ["attachment-1"] },
          { type: "attachmentPage", id: "attachment-page", attachmentId: "attachment-1", pageNumber: 1 },
          { type: "signatureGroup", id: "signatures", signers: [{ role: { zhCN: "报价方", enUS: "Offeror" }, name: "示例公司", dateLabel: { zhCN: "日期", enUS: "Date" } }] },
          { type: "pageBreak", id: "page-break" },
        ],
      },
    ],
    watermarks: [],
    disclaimers: ["quotation-non-advice"],
    attachmentManifest: [{ id: "attachment-1", category: "other", displayName: "附件一.pdf", mediaType: "application/pdf", pageCount: 1, required: false, status: "attached", includedInSubmission: true }],
  };
}
```

- [ ] **Step 2: Write normalization and HTML RED tests**

```tsx
import { render, screen } from "@testing-library/react";
import { compileStandardGoodsQuote, createStandardGoodsQuoteDraft } from "@opentrad/document-core";
import { describe, expect, it } from "vitest";
import { DocumentHtml } from "./DocumentHtml";
import { normalizeDocumentModel } from "../normalizeModel";
import { createEveryBlockModel } from "../testFixtures";

describe("V1/V2 HTML rendering", () => {
  it("normalizes V1 without changing its source object", () => {
    const source = compileStandardGoodsQuote(
      createStandardGoodsQuoteDraft({ id: "html-v1", now: "2026-08-19T00:00:00.000Z" }),
    );
    const before = JSON.stringify(source);
    const normalized = normalizeDocumentModel(source);
    expect(normalized.schemaVersion).toBe("2.0.0");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("renders every V2 block without injecting HTML", () => {
    render(
      <DocumentHtml
        model={createEveryBlockModel()}
        layoutStyleId="international-compact.v1"
        languageView="zh-en"
      />,
    );
    expect(screen.getByText("服务报价")).toBeInTheDocument();
    expect(screen.getByText("SERVICE QUOTATION")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "table" })).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
```

- [ ] **Step 3: Run both tests to verify RED**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/render/normalizeModel.test.ts src/features/documents/render/html/DocumentHtml.test.tsx`

Expected: FAIL because `normalizeDocumentModel` and `DocumentHtml` are missing.

- [ ] **Step 4: Implement a pure V1 adapter and exhaustive block renderer**

```ts
export function normalizeDocumentModel(input: DocumentModel | DocumentModelV2): DocumentModelV2 {
  if (input.schemaVersion === "2.0.0") return DocumentModelV2Schema.parse(input);
  const v1 = DocumentModelSchema.parse(input);
  return DocumentModelV2Schema.parse({
    schemaVersion: "2.0.0",
    documentId: v1.documentId,
    template: { id: v1.templateId, version: v1.templateVersion, basisDate: "2026-08-19" },
    documentKind: "quotation",
    language: "zh-CN",
    title: { zhCN: "标准货物报价单" },
    pageDefaults: v1.page,
    sections: [{ id: "v1-content", blocks: v1.nodes.map(convertV1Node) }],
    watermarks: [],
    disclaimers: ["quotation-non-advice"],
    attachmentManifest: [],
  });
}
```

`DocumentHtml` must use one exhaustive `switch (block.type)` and render native `<h1>`, `<p>`, `<dl>`, `<table>`, `<ol>/<ul>`, `<nav aria-label="目录">`, `<section>`, `<aside>` and signature elements. `attachmentPage` renders a local attachment placeholder with its manifest label; it never creates a remote URL. Add this exhaustive guard:

```ts
function assertNever(value: never): never {
  throw new Error(`Unsupported V2 document block: ${String(value)}`);
}
```

The component must not import or use `dangerouslySetInnerHTML`.

- [ ] **Step 5: Run HTML tests, typecheck and CSP test**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/render src/security/contentSecurityPolicy.test.ts && pnpm --filter @opentrad/web typecheck`

Expected: PASS; TypeScript proves all block variants are handled and CSP remains `connect-src 'self'`.

- [ ] **Step 6: Commit normalized HTML rendering**

```bash
git add apps/web/src/features/documents/render
git commit -m "feat: render versioned documents as semantic html"
```

### Task 7: Render every V2 block to DOCX

**Files:**
- Create: `apps/web/src/features/documents/render/docx/buildDocxPlan.ts`
- Create: `apps/web/src/features/documents/render/docx/renderDocxV2.ts`
- Modify: `apps/web/src/features/documents/render/index.ts`
- Test: `apps/web/src/features/documents/render/docx/renderDocxV2.test.ts`

- [ ] **Step 1: Write DOCX plan RED tests**

```ts
import { describe, expect, it } from "vitest";
import { buildDocxPlanV2, renderDocxV2 } from "./renderDocxV2";
import { createEveryBlockModel } from "../testFixtures";

describe("DOCX V2", () => {
  it("plans every block, a TOC field, page numbers and landscape section", async () => {
    const model = createEveryBlockModel();
    model.sections[0] = { ...model.sections[0]!, page: { orientation: "landscape" } };
    const plan = buildDocxPlanV2(model, "classic-formal.v1", "zh-en");
    expect(plan.sections[0]?.orientation).toBe("landscape");
    expect(plan.updateFields).toBe(true);
    expect(plan.blockKinds).toEqual([
      "cover", "heading", "paragraph", "keyValueGrid", "parties", "table", "totals",
      "clauseGroup", "list", "notice", "declaration", "toc", "complianceMatrix",
      "attachmentIndex", "attachmentPage", "signatureGroup", "pageBreak",
    ]);
    const blob = await renderDocxV2(model, "classic-formal.v1", "zh-en");
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(blob.size).toBeGreaterThan(1_000);
  });
});
```

- [ ] **Step 2: Run the DOCX test to verify RED**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/render/docx/renderDocxV2.test.ts`

Expected: FAIL because the V2 DOCX renderer is missing.

- [ ] **Step 3: Implement a renderer-neutral DOCX plan**

```ts
export interface DocxPlanV2 {
  title: string;
  languageView: DocumentLanguageV2;
  profile: PresentationProfileV1;
  updateFields: true;
  footer: { text: string; pageNumbers: true };
  sections: Array<{
    id: string;
    orientation: "portrait" | "landscape";
    widthTwips: number;
    heightTwips: number;
    marginsTwips: { top: number; right: number; bottom: number; left: number };
    blocks: DocumentBlockV2[];
  }>;
  blockKinds: DocumentBlockV2["type"][];
  watermarks: WatermarkPolicyV2[];
}
```

`buildDocxPlanV2` parses the model, resolves the frozen profile, chooses A4 portrait dimensions `11906 × 16838` twips or swaps them for landscape, validates each table width total as exactly 100%, and preserves block order.

- [ ] **Step 4: Implement concrete DOCX block mappings**

Map blocks as follows in one exhaustive switch:

```ts
switch (block.type) {
  case "cover": return coverParagraphs(block, context);
  case "heading": return [headingParagraph(block, context)];
  case "paragraph": return localizedParagraphs(block.text, context);
  case "keyValueGrid": return [keyValueTable(block, context)];
  case "parties": return [partiesTable(block, context)];
  case "table": return [dataTable(block, context)];
  case "totals": return [totalsTable(block, context)];
  case "clauseGroup": return clauseParagraphs(block, context);
  case "list": return listParagraphs(block, context);
  case "notice": return noticeParagraphs(block, context);
  case "declaration": return declarationParagraphs(block, context);
  case "toc": return [tableOfContents(block, context)];
  case "complianceMatrix": return [complianceTable(block, context)];
  case "attachmentIndex": return [attachmentIndexTable(block, context)];
  case "attachmentPage": return [attachmentPlaceholder(block, context)];
  case "signatureGroup": return [signatureTable(block, context)];
  case "pageBreak": return [pageBreakParagraph()];
  default: return assertNever(block);
}
```

Use Word Heading styles for TOC discovery, `TableOfContents` with hyperlinks, `updateFields: true`, field-based `PageNumber.CURRENT/TOTAL_PAGES`, repeating table header rows and `cantSplit` on protected rows. Watermark drawing must live in each section header and cannot be represented as editable body text.

- [ ] **Step 5: Run DOCX tests and existing quotation renderer tests**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/render/docx src/features/quotation/export/docx`

Expected: PASS; the existing standard quotation DOCX plan stays green.

- [ ] **Step 6: Commit DOCX V2**

```bash
git add apps/web/src/features/documents/render/docx apps/web/src/features/documents/render/index.ts
git commit -m "feat: render document model v2 to docx"
```

### Task 8: Render every V2 block to searchable PDF and assert output parity

**Files:**
- Create: `apps/web/src/features/documents/render/pdf/buildPdfDefinitionV2.ts`
- Create: `apps/web/src/features/documents/render/pdf/renderPdfV2.ts`
- Modify: `apps/web/src/features/documents/render/index.ts`
- Test: `apps/web/src/features/documents/render/pdf/renderPdfV2.test.ts`
- Test: `apps/web/src/features/documents/render/renderParityV2.test.ts`

- [ ] **Step 1: Write PDF and parity RED tests**

```ts
import { describe, expect, it } from "vitest";
import { buildPdfDefinitionV2 } from "./pdf/buildPdfDefinitionV2";
import { semanticTextDigest } from "./normalizeModel";
import { createEveryBlockModel } from "./testFixtures";

describe("PDF V2 and renderer parity", () => {
  it("uses local font, dynamic title, TOC and page watermark callback", () => {
    const model = createEveryBlockModel();
    model.watermarks = [{ id: "internal-draft", text: { zhCN: "内部底稿", enUS: "INTERNAL DRAFT" }, scope: "every-page" }];
    const definition = buildPdfDefinitionV2(model, "international-compact.v1", "zh-en");
    expect(definition.info?.title).toBe("服务报价 / SERVICE QUOTATION");
    expect(definition.defaultStyle?.font).toBe("SourceHanSansCN");
    expect(definition.watermark).toBeTypeOf("function");
    expect(JSON.stringify(definition.content)).toContain("toc");
  });

  it("keeps semantic content invariant across all three layouts", () => {
    const model = createEveryBlockModel();
    const digests = [
      "classic-formal.v1",
      "modern-business.v1",
      "international-compact.v1",
    ].map(() => semanticTextDigest(model, "zh-en"));
    expect(new Set(digests).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/render/pdf/renderPdfV2.test.ts src/features/documents/render/renderParityV2.test.ts`

Expected: FAIL because the V2 PDF definition and semantic digest are missing.

- [ ] **Step 3: Implement exhaustive pdfmake block mapping**

```ts
function blockToPdfContent(block: DocumentBlockV2, context: PdfContext): Content | Content[] {
  switch (block.type) {
    case "cover": return pdfCover(block, context);
    case "heading": return pdfHeading(block, context);
    case "paragraph": return pdfLocalizedParagraphs(block.text, context);
    case "keyValueGrid": return pdfKeyValueGrid(block, context);
    case "parties": return pdfParties(block, context);
    case "table": return pdfTable(block, context);
    case "totals": return pdfTotals(block, context);
    case "clauseGroup": return pdfClauses(block, context);
    case "list": return pdfList(block, context);
    case "notice": return pdfNotice(block, context);
    case "declaration": return pdfDeclaration(block, context);
    case "toc": return { toc: { title: pdfLocalizedText({ zhCN: "目录", enUS: "Contents" }, context) } };
    case "complianceMatrix": return pdfComplianceMatrix(block, context);
    case "attachmentIndex": return pdfAttachmentIndex(block, context);
    case "attachmentPage": return pdfAttachmentPlaceholder(block, context);
    case "signatureGroup": return pdfSignatureGroup(block, context);
    case "pageBreak": return { text: "", pageBreak: "after" };
    default: return assertNever(block);
  }
}
```

Use `tocItem` on heading content, local `SourceHanSansCN` font URLs through the existing strict same-origin policy, footer page numbers, dynamic metadata and per-page watermark callbacks. A landscape section starts with `pageBreak: "before"` and `pageOrientation: "landscape"`; the next portrait section explicitly restores portrait orientation.

- [ ] **Step 4: Implement semantic parity digest**

```ts
export function semanticTextDigest(model: DocumentModelV2, language: DocumentLanguageV2): string {
  const text = collectLocalizedSemanticText(DocumentModelV2Schema.parse(model), language);
  return text.map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean).join("\n");
}
```

The collector walks model title, every section block, table cell, clause, notice, declaration, signer and attachment label in document order. It excludes page numbers, watermark text and visual style tokens.

- [ ] **Step 5: Run V2/V1 PDF tests, font policy and parity tests**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/render src/features/quotation/export/pdf src/features/quotation/export/exportParity.test.ts`

Expected: PASS; no font URL outside `window.location.origin` is permitted.

- [ ] **Step 6: Commit PDF V2 and parity**

```bash
git add apps/web/src/features/documents/render
git commit -m "feat: render document model v2 to searchable pdf"
```

### Task 9: Add exact-money quote primitives shared by four templates

**Files:**
- Create: `packages/document-core/src/v2/money.ts`
- Create: `packages/document-core/src/v2/templates/quote-common.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/quote-common-v2.test.ts`

- [ ] **Step 1: Write RED tests for shared fields and exact totals**

```ts
import { describe, expect, it } from "vitest";
import { GoodsLineV2Schema, QuoteMetaV2Schema, calculateQuoteLinesV2 } from "../src/v2/index";

describe("V2 quotation primitives", () => {
  it("accepts bounded commercial metadata and rejects a reversed validity period", () => {
    const valid = {
      number: "SQ-20260819-001",
      title: "项目服务报价",
      issueDate: "2026-08-19",
      validUntil: "2026-09-18",
      currency: "CNY",
      taxMode: "tax-excluded",
      quoteNature: "invitation",
      language: "zh-CN",
      layoutStyleId: "modern-business.v1",
    };
    expect(QuoteMetaV2Schema.parse(valid)).toEqual(valid);
    expect(QuoteMetaV2Schema.safeParse({ ...valid, validUntil: "2026-08-18" }).success).toBe(false);
  });

  it("calculates quantity, discount and tax without JavaScript floating point", () => {
    const calculation = calculateQuoteLinesV2(
      [{ id: "line-1", quantity: "2.5", unitPriceMinor: "1999", discountBps: 500, taxRateBps: 1300 }],
      "tax-excluded",
    );
    expect(calculation.lines[0]).toMatchObject({ subtotalMinor: "4748", taxMinor: "617", totalMinor: "5365" });
    expect(calculation.summary.totalMinor).toBe("5365");
  });

  it("rejects caller-supplied HTML, exponent notation and more than 100 lines", () => {
    const line = { id: "line-1", name: "商品", unit: "件", quantity: "1", unitPriceMinor: "1", discountBps: 0, taxRateBps: 0 };
    expect(GoodsLineV2Schema.safeParse({ ...line, name: "<b>商品</b>" }).success).toBe(false);
    expect(GoodsLineV2Schema.safeParse({ ...line, quantity: "1e3" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the shared quote test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-common-v2.test.ts`

Expected: FAIL because the V2 quote schemas and calculator are missing.

- [ ] **Step 3: Implement the exact shared interfaces and schemas**

```ts
export interface QuoteMetaV2 {
  number: string;
  title: string;
  issueDate: string;
  validUntil: string;
  currency: "CNY" | "USD" | "EUR";
  taxMode: "tax-excluded" | "tax-included" | "tax-exempt";
  quoteNature: "invitation" | "binding-offer";
  language: DocumentLanguageV2;
  layoutStyleId: LayoutStyleId;
}

export interface GoodsLineV2 {
  id: string;
  name: string;
  englishName?: string;
  sku?: string;
  specification?: string;
  description?: string;
  unit: string;
  quantity: string;
  unitPriceMinor: string;
  discountBps: number;
  taxRateBps: number;
  countryOfOrigin?: string;
  hsCodeUserSupplied?: string;
  netWeightKg?: string;
  grossWeightKg?: string;
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
}

export interface ServiceLineV1 {
  id: string;
  serviceName: string;
  englishName?: string;
  deliverable: string;
  unit: string;
  quantity: string;
  unitPriceMinor: string;
  discountBps: number;
  taxRateBps: number;
  estimatedHours?: string;
  milestoneId?: string;
}
```

`QuoteMetaV2Schema` must use the existing real-calendar-date validator and require `validUntil >= issueDate`. `GoodsLineV2Schema` and `ServiceLineV1Schema` reuse V1 integer-minor money, six-decimal quantity and basis-point limits; optional decimal dimensions allow six integer and three fractional digits and must be positive.

- [ ] **Step 4: Implement half-up generic line calculation**

```ts
export interface CalculableLineV2 {
  id: string;
  quantity: string;
  unitPriceMinor: string;
  discountBps: number;
  taxRateBps: number;
}

export function calculateQuoteLinesV2(
  lines: readonly CalculableLineV2[],
  taxMode: QuoteMetaV2["taxMode"],
): QuoteCalculationV2 {
  const calculated = lines.map((line) => calculateLineAmountsExact(line, taxMode));
  return {
    lines: calculated,
    summary: sumCalculatedLines(calculated),
  };
}
```

Use integer numerator/denominator arithmetic and the V1 half-up helper; do not call `Number()` on quantity or money. For `tax-included`, split tax from the discounted inclusive amount. For `tax-exempt`, force tax to zero even if a line contains a non-zero tax rate.

- [ ] **Step 5: Run shared quote, V1 money and boundary tests**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-common-v2.test.ts tests/money.test.ts tests/boundaries.test.ts`

Expected: PASS; the V1 calculation fixtures remain unchanged.

- [ ] **Step 6: Commit quote primitives**

```bash
git add packages/document-core/src/v2/money.ts packages/document-core/src/v2/templates/quote-common.ts packages/document-core/src/v2/index.ts packages/document-core/tests/quote-common-v2.test.ts
git commit -m "feat: add shared quotation v2 primitives"
```

### Task 10: Add the four remaining quotation templates one version at a time

**Files:**
- Create: `packages/document-core/src/v2/templates/quotes/service-project.ts`
- Create: `packages/document-core/src/v2/templates/quotes/oem-custom.ts`
- Create: `packages/document-core/src/v2/templates/quotes/export-bilingual.ts`
- Create: `packages/document-core/src/v2/templates/quotes/proforma-invoice.ts`
- Create: `packages/document-core/src/v2/templates/index.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/quote-templates-v2.test.ts`
- Fixtures: `packages/document-core/tests/fixtures/v2/quotation-service-project.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/quotation-oem-custom.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/quotation-export-bilingual.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/quotation-proforma-invoice.json`

- [ ] **Step 1: Write a RED registry and AST-order test for all four quotes**

```ts
import { describe, expect, it } from "vitest";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index";

const expectedSections = {
  "quotation.service.project.v1": [
    "title", "quote-meta", "parties", "project-overview", "scope", "service-lines",
    "milestones", "totals", "assumptions", "exclusions", "delivery-acceptance",
    "payment-expenses", "ip-confidentiality", "quote-notice", "disclaimer", "signature",
  ],
  "quotation.oem.custom.v1": [
    "title", "quote-meta", "parties", "oem-basis", "technical-basis", "charge-lines",
    "totals", "sample-and-leadtime", "tooling", "materials", "quality-acceptance",
    "change-ip-confidentiality", "delivery-payment-warranty", "quote-notice", "disclaimer", "signature",
  ],
  "quotation.export.bilingual.v1": [
    "bilingual-title", "quote-meta", "bilingual-parties", "goods-table", "totals",
    "trade-term", "transport-shipment", "packaging-inspection", "payment-bank-charges",
    "document-list", "language-priority", "incoterms-notice", "disclaimer", "signature",
  ],
  "quotation.proforma.invoice.v1": [
    "proforma-banner", "invoice-meta", "exporter-importer", "consignee-notify", "goods-table",
    "weights-dimensions", "charges", "totals", "sale-term", "payment-shipping",
    "bank-instructions", "proforma-declaration", "disclaimer", "signature",
  ],
} as const;

describe("four V2 quote templates", () => {
  for (const [templateId, sectionIds] of Object.entries(expectedSections)) {
    it(`${templateId} compiles a stable section order`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const draft = registration.createDraft({ id: `${templateId}-gold`, now: "2026-08-19T00:00:00.000Z" });
      const model = registration.compile(draft);
      expect(model.sections.map((section) => section.id)).toEqual(sectionIds);
      expect(registration.definition.basisDate).toBe("2026-08-19");
    });
  }
});
```

- [ ] **Step 2: Run the quote-template test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-templates-v2.test.ts`

Expected: FAIL because the four quote registrations do not exist.

- [ ] **Step 3: Implement and commit the project/service quotation**

Use this complete draft contract:

```ts
export interface ServiceProjectQuoteDraftV1 {
  id: string;
  templateId: "quotation.service.project.v1";
  templateVersion: "1.0.0";
  meta: QuoteMetaV2;
  seller: EntityPartyV2;
  buyer: EntityPartyV2;
  project: { projectName: string; buyerReference?: string; objective: string; scope: string; assumptions?: string; exclusions?: string };
  serviceLines: ServiceLineV1[];
  milestones: Array<{ id: string; title: string; deliverable: string; dueDescription: string; acceptanceCriteria: string; paymentBps?: number }>;
  terms: {
    startDate?: string;
    duration: string;
    serviceLocation: string;
    customerDependencies?: string;
    expensePolicy: string;
    acceptance: string;
    payment: string;
    intellectualProperty: string;
    confidentiality?: string;
    changeControl: string;
    notes?: string;
  };
  updatedAt: string;
}
```

The compiler emits every listed section. Empty `assumptions` and `exclusions` still emit a heading with the explicit value `未约定`; this keeps the stable section order and makes omission visible. Preflight returns `blockSubmission` when a binding offer lacks payment, acceptance or duration, and `advisory` for an invitation quote.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-templates-v2.test.ts -t "quotation.service.project.v1"`

Expected: PASS for the service template and FAIL only for the three unimplemented quote IDs.

```bash
git add packages/document-core/src/v2/templates/quotes/service-project.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/quote-templates-v2.test.ts packages/document-core/tests/fixtures/v2/quotation-service-project.json
git commit -m "feat: add project service quotation template"
```

- [ ] **Step 4: Implement and commit the OEM quotation**

```ts
export interface OemCustomQuoteDraftV1 {
  id: string;
  templateId: "quotation.oem.custom.v1";
  templateVersion: "1.0.0";
  meta: QuoteMetaV2;
  seller: EntityPartyV2;
  buyer: EntityPartyV2;
  project: {
    projectName: string;
    productName: string;
    customerModel?: string;
    drawingVersion: string;
    sampleBasis?: string;
    annualForecast?: string;
    moq: string;
    prototypeQty?: string;
    massProductionQty?: string;
    buyerSuppliedMaterials: boolean;
  };
  chargeLines: Array<{
    id: string;
    chargeType: "unit-product" | "tooling" | "nre" | "sample" | "testing" | "packaging";
    name: string;
    specification?: string;
    unit: string;
    quantity: string;
    unitPriceMinor: string;
    discountBps: number;
    taxRateBps: number;
    amortizationQuantity?: string;
  }>;
  terms: {
    toolingRequired: boolean;
    toolingOwnership?: string;
    sampleApproval: string;
    prototypeLeadTime?: string;
    massProductionLeadTime: string;
    qualityStandard: string;
    acceptance: string;
    engineeringChange: string;
    packaging: string;
    delivery: string;
    payment: string;
    warranty: string;
    intellectualProperty: string;
    confidentiality: string;
    materialReceiptAndReturn?: string;
    notes?: string;
  };
  updatedAt: string;
}
```

Preflight rules are exact: `toolingRequired=true` and blank `toolingOwnership` is `blockSubmission`; any `tooling|nre` line without ownership is `blockSubmission`; `buyerSuppliedMaterials=true` and blank `materialReceiptAndReturn` is `blockSubmission`; blank IP or engineering-change terms are `watermark`.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-templates-v2.test.ts -t "quotation.oem.custom.v1"`

Expected: PASS for OEM quotation tests.

```bash
git add packages/document-core/src/v2/templates/quotes/oem-custom.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/quotation-oem-custom.json
git commit -m "feat: add oem custom quotation template"
```

- [ ] **Step 5: Implement and commit the bilingual export quotation**

```ts
export interface ExportBilingualQuoteDraftV1 {
  id: string;
  templateId: "quotation.export.bilingual.v1";
  templateVersion: "1.0.0";
  meta: QuoteMetaV2 & { language: "zh-en" };
  seller: EntityPartyV2;
  buyer: EntityPartyV2;
  buyerReference?: string;
  goodsLines: GoodsLineV2[];
  trade: {
    incotermsRule: "EXW" | "FCA" | "CPT" | "CIP" | "DAP" | "DPU" | "DDP" | "FAS" | "FOB" | "CFR" | "CIF";
    namedPlace: string;
    incotermsEdition: "2020";
    transportMode: "air" | "road" | "rail" | "sea" | "multimodal";
    originCountry: string;
    destinationCountry: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    shipmentWindow: string;
    partialShipment: boolean;
    transshipment: boolean;
    exportPackaging: string;
    paymentMethod: string;
    bankCharges: string;
    insuranceArrangement?: string;
    inspection: string;
    documentList: LocalizedText[];
    languagePriority: "zh-CN" | "en-US";
    notes?: LocalizedText;
  };
  updatedAt: string;
}
```

Require English party names, English item names and both languages for every exported clause. CIF/CIP without insurance is `blockSubmission`; FAS/FOB/CFR/CIF with non-sea transport is `blockSubmission`; EXW creates a warning about export clearance; DDP creates a warning about import obligations. The Incoterms notice must state that payment, ownership, remedies, applicable law and dispute resolution remain outside the rule.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-templates-v2.test.ts -t "quotation.export.bilingual.v1"`

Expected: PASS for bilingual quote tests including missing-English rejection.

```bash
git add packages/document-core/src/v2/templates/quotes/export-bilingual.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/quotation-export-bilingual.json
git commit -m "feat: add bilingual export quotation template"
```

- [ ] **Step 6: Implement and commit the Pro Forma Invoice**

```ts
export interface ProformaInvoiceDraftV1 {
  id: string;
  templateId: "quotation.proforma.invoice.v1";
  templateVersion: "1.0.0";
  meta: QuoteMetaV2;
  seller: EntityPartyV2;
  buyer: EntityPartyV2;
  consignee?: EntityPartyV2;
  notifyParty?: EntityPartyV2;
  buyerReference: string;
  purchaseOrderReference?: string;
  goodsLines: GoodsLineV2[];
  shipment: {
    packageCount?: string;
    totalNetWeightKg: string;
    totalGrossWeightKg: string;
    totalVolumeCbm?: string;
    incotermsRule: ExportBilingualQuoteDraftV1["trade"]["incotermsRule"];
    namedPlace: string;
    estimatedShippingDate: string;
    paymentTerms: string;
    originCountry: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    bankInstructions?: string;
    validityDate: string;
  };
  charges: {
    discountMinor?: string;
    freightMinor?: string;
    insuranceMinor?: string;
    otherCharges: Array<{ id: string; label: string; amountMinor: string }>;
  };
  updatedAt: string;
}
```

The compiler always emits this exact declaration in the selected language view: `PRO FORMA — 非税务发票、非商业发票、非付款请求、非装运单据`. The schema requires seller, buyer, buyer reference, item unit/extended prices, net/gross weight, Incoterms rule and named place, payment terms, estimated shipping date and validity date.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/quote-templates-v2.test.ts tests/quote-common-v2.test.ts`

Expected: PASS for all four quotation registrations and common calculation tests.

```bash
git add packages/document-core/src/v2/templates/quotes/proforma-invoice.ts packages/document-core/src/v2/templates/index.ts packages/document-core/src/v2/index.ts packages/document-core/tests/quote-templates-v2.test.ts packages/document-core/tests/fixtures/v2/quotation-proforma-invoice.json
git commit -m "feat: add pro forma invoice template"
```

- [ ] **Step 7: Run quote compatibility and type gates**

Run: `pnpm --filter @opentrad/document-core test && pnpm --filter @opentrad/document-core typecheck`

Expected: PASS; registry lists four V2 quotations while `STANDARD_GOODS_QUOTE_TEMPLATE` remains the unchanged V1 export.

### Task 11: Add contract metadata, clause and signature primitives

**Files:**
- Create: `packages/document-core/src/v2/templates/contract-common.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/contract-common-v2.test.ts`

- [ ] **Step 1: Write contract-common RED tests**

```ts
import { describe, expect, it } from "vitest";
import { ContractGeneralTermsV1Schema, ContractMetaV2Schema } from "../src/v2/index";

describe("V2 contract primitives", () => {
  const meta = {
    contractNumber: "CT-20260819-001",
    title: "销售合同",
    signingDate: "2026-08-19",
    signingPlace: "上海",
    effectiveMode: "signature",
    copies: 2,
    language: "zh-CN",
    layoutStyleId: "classic-formal.v1",
  };

  it("requires the selected dispute forum only", () => {
    const terms = {
      noticeAddresses: "以合同所列地址送达",
      confidentiality: "双方保密",
      forceMajeure: "及时通知并提供证明",
      changeControl: "书面变更",
      termination: "按约定解除",
      breachRemedies: "赔偿实际损失",
      governingLaw: "中华人民共和国法律",
      disputeMethod: "arbitration",
      arbitrationCommission: "上海国际经济贸易仲裁委员会",
      severability: "部分无效不影响其他条款",
      entireAgreement: "正文与附件构成完整协议",
    };
    expect(ContractGeneralTermsV1Schema.parse(terms)).toEqual(terms);
    expect(ContractGeneralTermsV1Schema.safeParse({ ...terms, arbitrationCommission: "" }).success).toBe(false);
    expect(ContractGeneralTermsV1Schema.safeParse({ ...terms, court: "上海市某法院" }).success).toBe(false);
  });

  it("requires an effective date only for date-based effectiveness", () => {
    expect(ContractMetaV2Schema.parse(meta)).toEqual(meta);
    expect(ContractMetaV2Schema.safeParse({ ...meta, effectiveMode: "date" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract-common test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-common-v2.test.ts`

Expected: FAIL because the contract schemas do not exist.

- [ ] **Step 3: Implement exact contract types and refinements**

```ts
export interface ContractMetaV2 {
  contractNumber: string;
  title: string;
  signingDate: string;
  signingPlace?: string;
  effectiveMode: "signature" | "date" | "condition";
  effectiveDate?: string;
  effectiveCondition?: string;
  copies: number;
  language: DocumentLanguageV2;
  languagePriority?: "zh-CN" | "en-US";
  layoutStyleId: LayoutStyleId;
}

export interface ContractGeneralTermsV1 {
  noticeAddresses: string;
  confidentiality: string;
  forceMajeure: string;
  changeControl: string;
  assignment?: string;
  compliance?: string;
  termination: string;
  breachRemedies: string;
  governingLaw: string;
  disputeMethod: "court" | "arbitration";
  court?: string;
  arbitrationCommission?: string;
  severability: string;
  entireAgreement: string;
  otherTerms?: string;
}

export interface PaymentMilestoneV1 {
  id: string;
  trigger: string;
  amountBps: number;
  dueDays: number;
}

export interface ContractSignerV1 {
  partyId: string;
  role: LocalizedText;
  signatoryName?: string;
  signatoryTitle?: string;
  dateLabel: LocalizedText;
  sealLabel: LocalizedText;
}
```

Refine payment schedules so basis points total 10,000. Refine `effectiveMode=date` to require a real `effectiveDate`, `effectiveMode=condition` to require `effectiveCondition`, `disputeMethod=court` to require only `court`, and `disputeMethod=arbitration` to require only `arbitrationCommission`. A `zh-en` contract requires `languagePriority`.

- [ ] **Step 4: Run contract-common and core boundary tests**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-common-v2.test.ts tests/boundaries.test.ts`

Expected: PASS; ambiguous dual forum, missing effective conditions and payment totals other than 10,000 are rejected.

- [ ] **Step 5: Commit contract primitives**

```bash
git add packages/document-core/src/v2/templates/contract-common.ts packages/document-core/src/v2/index.ts packages/document-core/tests/contract-common-v2.test.ts
git commit -m "feat: add shared contract v2 primitives"
```

### Task 12: Add five contract templates as immutable registrations

**Files:**
- Create: `packages/document-core/src/v2/templates/contracts/domestic-sale.ts`
- Create: `packages/document-core/src/v2/templates/contracts/framework-supply.ts`
- Create: `packages/document-core/src/v2/templates/contracts/oem-processing.ts`
- Create: `packages/document-core/src/v2/templates/contracts/commercial-service.ts`
- Create: `packages/document-core/src/v2/templates/contracts/international-sale.ts`
- Modify: `packages/document-core/src/v2/templates/index.ts`
- Test: `packages/document-core/tests/contract-templates-v2.test.ts`
- Fixtures: `packages/document-core/tests/fixtures/v2/contract-domestic-sale.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/contract-framework-supply.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/contract-oem-processing.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/contract-commercial-service.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/contract-international-sale.json`

- [ ] **Step 1: Write a RED registry, source and section-order matrix**

```ts
import { describe, expect, it } from "vitest";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index";

const contractMatrix = {
  "contract.sale.domestic-b2b.v1": {
    sources: ["prc-civil-code", "samr-contract-library"],
    sections: ["cover", "meta", "parties", "subject-goods", "price-tax-invoice", "payment", "delivery-packaging", "title-risk", "inspection-acceptance", "quality-warranty", "parties-obligations", "breach-termination", "force-majeure", "notices", "governing-law-dispute", "miscellaneous", "attachments", "signatures"],
  },
  "contract.supply.framework.v1": {
    sources: ["prc-civil-code", "samr-contract-library"],
    sections: ["cover", "meta", "parties", "framework-purpose", "term", "catalog-price", "forecast", "minimum-or-exclusivity", "orders-priority", "capacity-inventory", "delivery-acceptance", "reconciliation-payment", "quality-warranty", "continuity", "change-termination-transition", "general-terms", "order-template", "signatures"],
  },
  "contract.oem.processing.v1": {
    sources: ["prc-civil-code", "samr-entrustment-2025"],
    sections: ["cover", "meta", "parties", "commissioned-products", "technical-documents", "sample-approval", "materials", "tooling", "production-schedule", "fees-payment", "quality-inspection", "nonconformance-recall", "engineering-change", "ip-license", "confidentiality-subcontracting", "termination-compensation", "general-terms", "attachments", "signatures"],
  },
  "contract.service.commercial.v1": {
    sources: ["samr-entrustment-2025", "prc-civil-code"],
    sections: ["cover", "meta", "parties", "service-matter", "work-requirements", "term-location", "deliverables-reporting", "client-dependencies", "subcontract-parallel-engagement", "fees-expenses-payment", "acceptance", "ip-data-confidentiality", "agency-third-party", "rights-obligations", "breach", "termination-at-will", "general-terms", "signatures"],
  },
  "contract.sale.international-bilingual.v1": {
    sources: ["uncitral-cisg", "icc-incoterms-2020"],
    sections: ["bilingual-cover", "meta", "bilingual-parties", "definitions", "goods", "price", "incoterms-delivery-risk", "shipment", "clearance-insurance", "documents", "inspection-claims", "title", "payment-bank", "packaging-marks", "warranty-ip", "compliance", "force-majeure-hardship", "breach-remedies", "cisg-governing-law", "dispute", "language-priority", "notices", "signatures"],
  },
} as const;

describe("five V2 contract templates", () => {
  for (const [templateId, expected] of Object.entries(contractMatrix)) {
    it(`${templateId} pins sources and section order`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const draft = registration.createDraft({ id: `${templateId}-gold`, now: "2026-08-19T00:00:00.000Z" });
      const model = registration.compile(draft);
      expect(registration.definition.sourceKeys).toEqual(expected.sources);
      expect(model.sections.map((section) => section.id)).toEqual(expected.sections);
    });
  }
});
```

- [ ] **Step 2: Run the contract-template test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-templates-v2.test.ts`

Expected: FAIL because none of the five contract registrations exists.

- [ ] **Step 3: Implement and commit the domestic B2B sale contract**

```ts
export interface DomesticSaleContractDraftV1 {
  id: string;
  templateId: "contract.sale.domestic-b2b.v1";
  templateVersion: "1.0.0";
  meta: ContractMetaV2;
  seller: EntityPartyV2;
  buyer: EntityPartyV2;
  goodsLines: Array<GoodsLineV2 & { brand?: string; manufacturer?: string; qualityStandard: string }>;
  price: { invoiceType: "vat-special" | "vat-general" | "other"; invoiceTiming: string; paymentSchedule: PaymentMilestoneV1[]; retentionBps?: number };
  delivery: { method: "seller-delivery" | "buyer-pickup" | "carrier"; time: string; place: string; packaging: string; freightAllocation: string; insuranceAllocation?: string; titleTransfer: string; riskTransfer: string; documents: string[] };
  acceptance: { inspectionStandard: string; inspectionMethod: string; inspectionPeriod: string; objectionMethod: string; warranty: string; afterSales: string };
  generalTerms: ContractGeneralTermsV1;
  signers: ContractSignerV1[];
  attachments: AttachmentRefV1[];
  updatedAt: string;
}
```

The compiler writes separate ownership and risk clauses. Preflight marks blank inspection period, objection method, risk transfer or invoice timing as `blockSubmission`. It never inserts a statutory tax rate or selects an invoice type.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-templates-v2.test.ts -t "contract.sale.domestic-b2b.v1"`

Expected: PASS for domestic-sale tests.

```bash
git add packages/document-core/src/v2/templates/contracts/domestic-sale.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/contract-templates-v2.test.ts packages/document-core/tests/fixtures/v2/contract-domestic-sale.json
git commit -m "feat: add domestic b2b sale contract"
```

- [ ] **Step 4: Implement and commit the framework supply contract**

```ts
export interface FrameworkSupplyContractDraftV1 {
  id: string;
  templateId: "contract.supply.framework.v1";
  templateVersion: "1.0.0";
  meta: ContractMetaV2;
  supplier: EntityPartyV2;
  purchaser: EntityPartyV2;
  term: { startDate: string; endDate: string };
  catalogLines: GoodsLineV2[];
  pricing: { priceMethod: string; adjustmentTrigger: string; adjustmentNoticeDays: number };
  forecast: { frequency: string; binding: boolean; minimumPurchaseCommitment?: string; exclusivity?: string };
  riskAcknowledgements: { commercialRiskConfirmed: boolean };
  ordering: { formation: string; approval: string; documentPriority: string; moq: string; leadTime: string; capacityCommitment?: string; inventoryPolicy?: string };
  performance: { delivery: string; acceptance: string; reconciliationCycle: string; invoice: string; settlement: string; quality: string; warranty: string; supplyContinuity: string; transitionAssistance?: string };
  orderTemplateAttachmentId?: string;
  generalTerms: ContractGeneralTermsV1;
  signers: ContractSignerV1[];
  attachments: AttachmentRefV1[];
  updatedAt: string;
}
```

When `forecast.binding=false`, emit the non-removable clause “预测和目录不当然构成采购义务”. Non-empty minimum commitment or exclusivity creates a `watermark` finding until `riskAcknowledgements.commercialRiskConfirmed=true`; acknowledgements are not rendered as contract terms.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-templates-v2.test.ts -t "contract.supply.framework.v1"`

Expected: PASS for framework tests.

```bash
git add packages/document-core/src/v2/templates/contracts/framework-supply.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/contract-framework-supply.json
git commit -m "feat: add framework supply contract"
```

- [ ] **Step 5: Implement and commit the OEM processing contract**

```ts
export interface OemProcessingContractDraftV1 {
  id: string;
  templateId: "contract.oem.processing.v1";
  templateVersion: "1.0.0";
  meta: ContractMetaV2;
  principal: EntityPartyV2;
  processor: EntityPartyV2;
  products: GoodsLineV2[];
  technical: { packageVersion: string; drawingAttachmentIds: string[]; sampleApproval: string; engineeringChange: string };
  materials: { mode: "principal-supplied" | "processor-supplied" | "mixed"; items: string[]; yieldTarget?: string; scrapHandling?: string; returnMethod?: string };
  tooling: Array<{ id: string; name: string; owner: "principal" | "processor" | "shared"; custody: string; maintenance: string; returnOrDisposal: string }>;
  production: { schedule: string; processingFeeLines: GoodsLineV2[]; paymentSchedule: PaymentMilestoneV1[] };
  quality: { standard: string; inspection: string; nonconformingProduct: string; traceability?: string; recall?: string };
  intellectualProperty: { backgroundIp: string; foregroundIp: string; licenseScope?: string; confidentiality: string };
  subcontracting: string;
  terminationCompensation: string;
  generalTerms: ContractGeneralTermsV1;
  signers: ContractSignerV1[];
  attachments: AttachmentRefV1[];
  updatedAt: string;
}
```

Principal-supplied or mixed materials require yield, scrap and return rules. Each tooling row requires owner, custody, maintenance and return/disposal. Blank background IP, foreground IP, subcontracting or termination compensation is `blockSubmission`.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-templates-v2.test.ts -t "contract.oem.processing.v1"`

Expected: PASS for OEM processing tests.

```bash
git add packages/document-core/src/v2/templates/contracts/oem-processing.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/contract-oem-processing.json
git commit -m "feat: add oem processing contract"
```

- [ ] **Step 6: Implement and commit the commercial service contract**

```ts
export interface CommercialServiceContractDraftV1 {
  id: string;
  templateId: "contract.service.commercial.v1";
  templateVersion: "1.0.0";
  meta: ContractMetaV2;
  client: EntityPartyV2;
  provider: EntityPartyV2;
  engagement: { type: "specific" | "general"; serviceMatter: string; scope: string; workRequirements: string; serviceLocation: string; startDate: string; endDate: string; reportingMethod: string; clientDependencies: string };
  deliverables: Array<{ id: string; name: string; dueDate: string; acceptanceStandard: string }>;
  delegation: { subcontractConsent: "allowed" | "written-consent" | "prohibited"; parallelEngagementConsent: "allowed" | "written-consent" | "prohibited" };
  fees: { model: "fixed" | "time-material" | "milestone"; lines: ServiceLineV1[]; necessaryExpenses: string; paymentSchedule: PaymentMilestoneV1[] };
  acceptance: { standard: string; period: string; deemedAcceptance?: string };
  rights: { ipOwnership: "client" | "provider" | "shared" | "custom"; ipCustomText?: string; dataHandling?: string; personalDataInvolved: boolean; personalDataTerms?: string; confidentiality: string };
  agency: { relationship: "no-agency" | "authorized-agency"; thirdPartyAuthority?: string };
  terminationAtWill: { handling: string; compensation: string };
  generalTerms: ContractGeneralTermsV1;
  signers: ContractSignerV1[];
  updatedAt: string;
}
```

`personalDataInvolved=true` requires purpose, scope, retention, access, deletion and incident notice in `personalDataTerms`. `authorized-agency` requires third-party authority scope and duration. Both termination-at-will fields are mandatory because the official 2025 model highlights this risk.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-templates-v2.test.ts -t "contract.service.commercial.v1"`

Expected: PASS for commercial-service tests.

```bash
git add packages/document-core/src/v2/templates/contracts/commercial-service.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/contract-commercial-service.json
git commit -m "feat: add commercial service contract"
```

- [ ] **Step 7: Implement and commit the bilingual international sale contract**

```ts
export interface InternationalSaleContractDraftV1 {
  id: string;
  templateId: "contract.sale.international-bilingual.v1";
  templateVersion: "1.0.0";
  meta: ContractMetaV2 & { language: "zh-en"; languagePriority: "zh-CN" | "en-US" };
  seller: EntityPartyV2;
  buyer: EntityPartyV2;
  goodsLines: GoodsLineV2[];
  price: { currency: "CNY" | "USD" | "EUR"; adjustment?: LocalizedText };
  trade: { incotermsRule: ExportBilingualQuoteDraftV1["trade"]["incotermsRule"]; namedPlace: string; incotermsEdition: "2020"; transportMode: ExportBilingualQuoteDraftV1["trade"]["transportMode"]; shipmentWindow: string; partialShipment: boolean; transshipment: boolean; exportClearanceParty: "seller" | "buyer"; importClearanceParty: "seller" | "buyer"; insurance: string; shippingDocuments: LocalizedText[] };
  acceptance: { inspection: LocalizedText; claimsPeriod: LocalizedText; titleTransfer: LocalizedText; riskTransfer: LocalizedText };
  payment: { method: "advance" | "open-account" | "letter-of-credit" | "collection" | "custom"; terms: LocalizedText; letterOfCreditTerms?: LocalizedText; bankCharges: LocalizedText };
  performance: { packaging: LocalizedText; shippingMarks: LocalizedText; warranty: LocalizedText; intellectualProperty: LocalizedText; sanctionsAndExportControlAcknowledgement: LocalizedText; forceMajeureAndHardship: LocalizedText; breachRemedies: LocalizedText };
  legal: { cisgChoice: "apply" | "exclude" | "undecided"; governingLaw: LocalizedText; disputeMethod: "court" | "arbitration"; forum: LocalizedText; notices: LocalizedText };
  signers: ContractSignerV1[];
  updatedAt: string;
}
```

Every rendered commercial clause requires both `zhCN` and `enUS`. `cisgChoice=undecided`, blank governing law, blank forum or absent language priority creates `blockSubmission`; draft/review export remains available with `国际销售合同草案 / DRAFT INTERNATIONAL SALE CONTRACT` watermark. Incoterms validation reuses the export quotation rules and cannot decide CISG applicability automatically.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/contract-templates-v2.test.ts tests/contract-common-v2.test.ts`

Expected: PASS for all five contract registrations, including bilingual completeness and CISG undecided-watermark cases.

```bash
git add packages/document-core/src/v2/templates/contracts/international-sale.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/contract-templates-v2.test.ts packages/document-core/tests/fixtures/v2/contract-international-sale.json
git commit -m "feat: add bilingual international sale contract"
```

- [ ] **Step 8: Run all core tests after contract registration**

Run: `pnpm --filter @opentrad/document-core test && pnpm --filter @opentrad/document-core typecheck`

Expected: PASS; registry now contains 4 V2 quotations and 5 V2 contracts, while all V1 tests remain green.

### Task 13: Add bid source baselines, truthful evidence and the export state machine

**Files:**
- Create: `packages/document-core/src/v2/templates/bid-common.ts`
- Modify: `packages/document-core/src/v2/index.ts`
- Test: `packages/document-core/tests/bid-common-v2.test.ts`

- [ ] **Step 1: Write RED tests for internal-draft and submission decisions**

```ts
import { describe, expect, it } from "vitest";
import { decideBidExport } from "../src/v2/index";

const completeSource = {
  issuer: "某采购单位",
  projectName: "设备采购项目",
  projectNumber: "CG-2026-001",
  versionLabel: "招标文件正式版及澄清01",
  issueDate: "2026-08-01",
  clarificationIds: ["澄清01"],
  bidDeadline: "2026-08-25T09:00:00+08:00",
  bidValidityDays: 90,
  submissionMode: "electronic",
  signatureRules: "按采购平台要求电子签章",
  currency: "CNY",
  evaluationMethod: "comprehensive-score",
  jointVentureAllowed: false,
  subcontractAllowed: false,
};

describe("bid export state", () => {
  it("forces every-page draft watermark without an exact source version", () => {
    const decision = decideBidExport({ source: { ...completeSource, versionLabel: "" }, findings: [] });
    expect(decision.mode).toBe("internal-draft");
    expect(decision.watermarks[0]?.text.zhCN).toContain("不得提交");
  });

  it("blocks submission for an unanswered substantial requirement", () => {
    const decision = decideBidExport({
      source: completeSource,
      findings: [{ code: "BID_SUBSTANTIAL_UNANSWERED", severity: "error", impact: "blockSubmission", message: "实质性要求未响应" }],
    });
    expect(decision.mode).toBe("review-copy");
    expect(decision.canExportSubmission).toBe(false);
  });

  it("allows submission only after the exact version and all checks pass", () => {
    const decision = decideBidExport({ source: completeSource, findings: [] });
    expect(decision).toMatchObject({ mode: "submission", canExportSubmission: true, watermarks: [] });
  });
});
```

- [ ] **Step 2: Run the bid-common test to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-common-v2.test.ts`

Expected: FAIL because bid common types and `decideBidExport` are missing.

- [ ] **Step 3: Implement exact bid base fields**

```ts
export interface SolicitationSnapshotV1 {
  issuer: string;
  agency?: string;
  projectName: string;
  projectNumber: string;
  packageNumber?: string;
  versionLabel: string;
  issueDate: string;
  clarificationIds: string[];
  bidDeadline: string;
  openingTime?: string;
  openingPlace?: string;
  bidValidityDays: number;
  submissionMode: "paper" | "electronic" | "both";
  signatureRules: string;
  sealingRules?: string;
  currency: "CNY" | "USD" | "EUR";
  maximumPriceMinor?: string;
  evaluationMethod: "lowest-price" | "comprehensive-score" | "comprehensive-evaluation" | "other";
  jointVentureAllowed: boolean;
  subcontractAllowed: boolean;
}

export interface RequirementResponseV1 {
  id: string;
  sourceRef: string;
  category: "qualification" | "commercial" | "technical" | "service" | "price" | "submission";
  requirementText: string;
  substantial: boolean;
  responseStatus: "not-started" | "drafted" | "reviewed";
  responseText: string;
  offeredValue?: string;
  compliance: "yes" | "partial" | "no" | "unreviewed";
  deviation?: string;
  evidenceAttachmentIds: string[];
  owner?: string;
  reviewStatus: "pending" | "accepted" | "rejected";
}

export interface QualificationItemV1 {
  id: string;
  sourceRef: string;
  name: string;
  required: boolean;
  issuer?: string;
  certificateNumber?: string;
  validUntil?: string;
  attachmentId?: string;
  status: "missing" | "attached" | "not-applicable";
  userConfirmedTruth: boolean;
}

export interface BidDraftBaseV1 {
  id: string;
  templateId: string;
  templateVersion: "1.0.0";
  source: SolicitationSnapshotV1;
  bidder: EntityPartyV2;
  authorizedRepresentative?: string;
  consortiumMembers: EntityPartyV2[];
  requirements: RequirementResponseV1[];
  qualifications: QualificationItemV1[];
  businessDeviations: Array<{ id: string; sourceRef: string; requirement: string; response: string; deviation: string }>;
  technicalDeviations: Array<{ id: string; sourceRef: string; requirement: string; response: string; deviation: string }>;
  projectReferences: Array<{ id: string; projectName: string; customer: string; period: string; scope: string; evidenceAttachmentId?: string; userConfirmedTruth: boolean }>;
  attachments: AttachmentRefV1[];
  bidGuarantee?: { method: string; amountMinor: string; reference: string; attachmentId?: string };
  submissionCopies?: { original: number; copies: number; electronic: number };
  signSealChecklist: Array<{ id: string; sourceRef: string; label: string; confirmed: boolean }>;
  finalReviewers: Array<{ name: string; role: string; reviewedAt: string }>;
  updatedAt: string;
}
```

Schema limits: 500 requirements, 200 qualifications, 200 attachments, 200 deviations, 100 references and 100 checklist rows. `requirementText` is local draft content and is never logged; do not create a server-side content digest or analytics event.

- [ ] **Step 4: Implement deterministic export decisions**

```ts
export interface BidExportDecisionV1 {
  mode: "internal-draft" | "review-copy" | "submission";
  canExportSubmission: boolean;
  watermarks: WatermarkPolicyV2[];
  blockingCodes: string[];
}

export function decideBidExport(input: {
  source: SolicitationSnapshotV1;
  findings: readonly RiskFindingV2[];
}): BidExportDecisionV1 {
  const sourceComplete = Boolean(
    input.source.issuer.trim() &&
      input.source.projectName.trim() &&
      input.source.projectNumber.trim() &&
      input.source.versionLabel.trim() &&
      input.source.issueDate.trim() &&
      input.source.bidDeadline.trim(),
  );
  if (!sourceComplete) {
    return {
      mode: "internal-draft",
      canExportSubmission: false,
      watermarks: [{ id: "unbound-source", text: { zhCN: "内部投标底稿 · 未绑定完整招标文件版本 · 不得提交", enUS: "INTERNAL DRAFT · SOURCE VERSION INCOMPLETE · DO NOT SUBMIT" }, scope: "every-page" }],
      blockingCodes: ["BID_SOURCE_VERSION_INCOMPLETE"],
    };
  }
  const blockingCodes = input.findings.filter((finding) => finding.impact === "blockSubmission").map((finding) => finding.code);
  return blockingCodes.length > 0
    ? { mode: "review-copy", canExportSubmission: false, watermarks: [{ id: "review-copy", text: { zhCN: "审核稿 · 不得提交", enUS: "REVIEW COPY · DO NOT SUBMIT" }, scope: "every-page" }], blockingCodes }
    : { mode: "submission", canExportSubmission: true, watermarks: [], blockingCodes: [] };
}
```

Preflight common rules must emit `blockSubmission` for unanswered substantial requirements, `compliance=partial|no|unreviewed` on substantial rows, missing required qualification attachments, any attached qualification without `userConfirmedTruth`, inconsistent deviation matrices, unconfirmed sign/seal rows, missing guarantee when listed as required, and total price above `maximumPriceMinor`.

- [ ] **Step 5: Run bid-common tests and compatibility tests**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-common-v2.test.ts tests/v1-compatibility.test.ts`

Expected: PASS; draft watermarks cannot be suppressed by caller input.

- [ ] **Step 6: Commit bid state foundation**

```bash
git add packages/document-core/src/v2/templates/bid-common.ts packages/document-core/src/v2/index.ts packages/document-core/tests/bid-common-v2.test.ts
git commit -m "feat: add bid source and export state rules"
```

### Task 14: Add five bid templates with source-bound compilers

**Files:**
- Create: `packages/document-core/src/v2/templates/bids/government-goods.ts`
- Create: `packages/document-core/src/v2/templates/bids/government-services.ts`
- Create: `packages/document-core/src/v2/templates/bids/construction-works.ts`
- Create: `packages/document-core/src/v2/templates/bids/enterprise-goods.ts`
- Create: `packages/document-core/src/v2/templates/bids/enterprise-services.ts`
- Modify: `packages/document-core/src/v2/templates/index.ts`
- Test: `packages/document-core/tests/bid-templates-v2.test.ts`
- Fixtures: `packages/document-core/tests/fixtures/v2/bid-government-goods.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/bid-government-services.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/bid-construction-works.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/bid-enterprise-goods.json`
- Fixtures: `packages/document-core/tests/fixtures/v2/bid-enterprise-services.json`

- [ ] **Step 1: Write the bid registry, source and section-order RED matrix**

```ts
import { describe, expect, it } from "vitest";
import { V2_TEMPLATE_REGISTRY } from "../src/v2/templates/index";

const bidMatrix = {
  "bid.government.goods.v1": ["draft-cover", "source-baseline", "toc", "bid-letter", "legal-representative", "authorization", "qualification-index", "qualifications", "policy-declarations", "opening-price", "itemized-price", "technical-response", "business-response", "delivery-installation", "training-acceptance", "warranty-aftersales", "deviations", "attachments", "final-checklist", "signatures"],
  "bid.government.services.v1": ["draft-cover", "source-baseline", "toc", "bid-letter", "authorization", "qualifications", "policy-declarations", "opening-price", "service-price", "requirement-response", "understanding-objectives", "methodology", "deliverables-schedule", "staffing", "quality-sla", "risk-security-privacy", "acceptance", "performance-evidence", "deviations", "attachments", "final-checklist", "signatures"],
  "bid.construction.works.v1": ["internal-cover", "source-baseline", "toc", "bid-letter-and-appendix", "authorization", "qualifications", "guarantee", "priced-boq", "commercial-deviations", "technical-deviations", "construction-organization", "schedule", "site-resources", "project-manager", "key-personnel", "equipment", "quality", "safety-environment", "subcontract", "experience", "attachments", "final-checklist", "signatures"],
  "bid.enterprise.goods.v1": ["draft-cover", "source-baseline", "toc", "offer-letter", "bidder-profile", "qualifications", "executive-summary", "price", "goods-offer", "requirements-matrix", "technical-solution", "delivery", "quality-acceptance", "warranty-aftersales", "continuity", "commercial-terms", "deviations", "cases", "attachments", "checklist", "signatures"],
  "bid.enterprise.services.v1": ["draft-cover", "source-baseline", "toc", "proposal-letter", "executive-summary", "customer-understanding", "scope", "methodology", "deliverables", "schedule", "team-governance", "sla-quality", "security-privacy", "assumptions-dependencies-exclusions", "commercial-offer", "cases", "risks", "deviations", "attachments", "checklist", "signatures"],
} as const;

describe("five V2 bid templates", () => {
  for (const [templateId, sectionIds] of Object.entries(bidMatrix)) {
    it(`${templateId} compiles with source state and stable sections`, () => {
      const registration = V2_TEMPLATE_REGISTRY.get(templateId, "1.0.0");
      const draft = registration.createDraft({ id: `${templateId}-gold`, now: "2026-08-19T00:00:00.000Z" });
      const model = registration.compile(draft);
      expect(model.sections.map((section) => section.id)).toEqual(sectionIds);
      expect(model.watermarks[0]?.text.zhCN).toContain("不得提交");
    });
  }
});
```

- [ ] **Step 2: Run bid template tests to verify RED**

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-templates-v2.test.ts`

Expected: FAIL because all five bid registrations are missing.

- [ ] **Step 3: Define the five exact specialized draft interfaces**

```ts
export interface GovernmentGoodsBidDraftV1 extends BidDraftBaseV1 {
  templateId: "bid.government.goods.v1";
  coreProduct?: string;
  goodsOfferLines: Array<{ id: string; name: string; brand: string; model: string; manufacturer: string; origin: string; specification: string; quantity: string; unit: string; unitPriceMinor: string; taxRateBps: number; policyAttributes?: string }>;
  technicalMatrix: RequirementResponseV1[];
  businessMatrix: RequirementResponseV1[];
  plans: { delivery: string; installation?: string; training?: string; acceptance: string; warranty: string; afterSales: string };
  policyDeclarations: Array<{ id: string; policyName: string; statement: string; evidenceAttachmentIds: string[]; applicable: boolean; userConfirmedTruth: boolean }>;
}

export interface GovernmentServicesBidDraftV1 extends BidDraftBaseV1 {
  templateId: "bid.government.services.v1";
  serviceUnderstanding: string;
  objectives: string;
  methodology: string;
  workPackages: Array<{ id: string; name: string; activities: string; deliverables: string[] }>;
  deliverables: Array<{ id: string; name: string; dueDate: string; acceptanceStandard: string }>;
  milestones: Array<{ id: string; name: string; date: string; dependency?: string }>;
  sla: Array<{ id: string; metric: string; target: string; measurement: string; remedy?: string }>;
  staffing: Array<{ id: string; name: string; role: string; qualification: string; experience: string; allocation: string; userConfirmedTruth: boolean }>;
  projectManager: string;
  qualityPlan: string;
  riskPlan: string;
  securityPlan?: string;
  privacyPlan?: string;
  businessContinuity?: string;
  acceptancePlan: string;
  servicePriceLines: ServiceLineV1[];
  performanceEvidence: BidDraftBaseV1["projectReferences"];
  policyDeclarations: GovernmentGoodsBidDraftV1["policyDeclarations"];
}

export interface ConstructionWorksBidDraftV1 extends BidDraftBaseV1 {
  templateId: "bid.construction.works.v1";
  projectScope: string;
  billOfQuantitiesRef: string;
  bidPriceMinor: string;
  durationDays: number;
  qualityTarget: string;
  projectManager: { name: string; qualification: string; certificateNumber: string; experience: BidDraftBaseV1["projectReferences"]; userConfirmedTruth: boolean };
  keyTechnicalPersonnel: Array<{ id: string; name: string; role: string; qualification: string; experience: string; userConfirmedTruth: boolean }>;
  laborPlan: Array<{ trade: string; count: number; period: string }>;
  equipmentList: Array<{ id: string; name: string; model: string; quantity: number; ownership: "owned" | "leased" | "planned"; availability: string; userConfirmedTruth: boolean }>;
  constructionOrganization: string;
  schedulePlan: string;
  sitePlan?: string;
  qualityPlan: string;
  safetyPlan: string;
  environmentPlan: string;
  emergencyPlan: string;
  subcontractPlan?: string;
  materialsPlan?: string;
  temporaryWorks?: string;
}

export interface EnterpriseGoodsBidDraftV1 extends BidDraftBaseV1 {
  templateId: "bid.enterprise.goods.v1";
  executiveSummary: string;
  goodsOfferLines: GovernmentGoodsBidDraftV1["goodsOfferLines"];
  requirementMatrix: RequirementResponseV1[];
  commercialOffer: string;
  technicalOffer: string;
  deliveryPlan: string;
  qualityAssurance: string;
  inspectionAcceptance: string;
  warranty: string;
  afterSales: string;
  supplyContinuity?: string;
  inventoryPlan?: string;
  manufacturerSupport?: string;
  contractAcceptanceDeviations: BidDraftBaseV1["businessDeviations"];
}

export interface EnterpriseServicesBidDraftV1 extends BidDraftBaseV1 {
  templateId: "bid.enterprise.services.v1";
  executiveSummary: string;
  customerUnderstanding: string;
  objectives: string;
  scope: string;
  methodology: string;
  deliverables: GovernmentServicesBidDraftV1["deliverables"];
  milestones: GovernmentServicesBidDraftV1["milestones"];
  team: GovernmentServicesBidDraftV1["staffing"];
  governance: string;
  communicationPlan: string;
  sla: GovernmentServicesBidDraftV1["sla"];
  qualityPlan: string;
  securityPrivacy?: string;
  assumptions: string[];
  dependencies: string[];
  exclusions: string[];
  servicePriceLines: ServiceLineV1[];
  caseStudies: BidDraftBaseV1["projectReferences"];
  riskRegister: Array<{ id: string; risk: string; probability: "low" | "medium" | "high"; impact: "low" | "medium" | "high"; mitigation: string; owner: string }>;
  contractDeviations: BidDraftBaseV1["businessDeviations"];
}
```

- [ ] **Step 4: Implement and commit government goods bid**

Register sources `mof-order-87` and `mof-demand-management`, default layout `classic-formal.v1`, and compile the exact section sequence in Step 1. Price summary and itemized price must be recalculated from `goodsOfferLines`; a mismatch with any caller-provided opening price is `blockSubmission`. Policy declarations render only when `applicable=true && userConfirmedTruth=true`; all other states remain visible in the internal checklist and never produce an affirmative statement.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-templates-v2.test.ts -t "bid.government.goods.v1"`

Expected: PASS for government-goods tests.

```bash
git add packages/document-core/src/v2/templates/bids/government-goods.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/bid-templates-v2.test.ts packages/document-core/tests/fixtures/v2/bid-government-goods.json
git commit -m "feat: add government goods bid template"
```

- [ ] **Step 5: Implement and commit government services bid**

Register the same two Ministry of Finance sources. Require service understanding, methodology, deliverables, staffing, quality, risk, acceptance and price. When any staff or performance evidence lacks `userConfirmedTruth`, emit `blockSubmission`. Security, privacy and continuity sections remain in stable AST order and display `本项目未要求/未提供` when empty, so absence is reviewable.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-templates-v2.test.ts -t "bid.government.services.v1"`

Expected: PASS for government-services tests.

```bash
git add packages/document-core/src/v2/templates/bids/government-services.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/bid-government-services.json
git commit -m "feat: add government services bid template"
```

- [ ] **Step 6: Implement and commit construction works bid**

Register sources `prc-tendering-law`, `ndrc-standard-construction` and `ndrc-tenderer-responsibility`. Require project manager identity, qualification and truthful confirmation; require at least one key technical person and one equipment row. The compiler references the actual bill of quantities by `billOfQuantitiesRef` and never invents quantities, standard tender conditions or qualification claims. `priced-boq`, deviations and equipment sections use landscape pages.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-templates-v2.test.ts -t "bid.construction.works.v1"`

Expected: PASS for construction tests, including project-manager, equipment and source-version blocking.

```bash
git add packages/document-core/src/v2/templates/bids/construction-works.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/bid-construction-works.json
git commit -m "feat: add construction works bid template"
```

- [ ] **Step 7: Implement and commit enterprise goods bid**

Register source `prc-tendering-law` as contextual only and mark the template detail copy “是否适用招标法律规则取决于项目和采购主体”. Require an exact enterprise solicitation snapshot, goods offer, requirement matrix, delivery, quality, acceptance, warranty and after-sales. Empty optional continuity, inventory and manufacturer support sections render as explicit “未提供” entries in review copies.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-templates-v2.test.ts -t "bid.enterprise.goods.v1"`

Expected: PASS for enterprise-goods tests.

```bash
git add packages/document-core/src/v2/templates/bids/enterprise-goods.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/fixtures/v2/bid-enterprise-goods.json
git commit -m "feat: add enterprise goods bid template"
```

- [ ] **Step 8: Implement and commit enterprise services bid**

Register source `prc-tendering-law` with the same contextual notice. Require scope, methodology, deliverables, team, governance, communication, SLA, quality, price and at least one risk register row. Assumptions, dependencies and exclusions are separate arrays and must never be concatenated into a single unreviewable free-text field.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/bid-templates-v2.test.ts tests/bid-common-v2.test.ts`

Expected: PASS for all five bid registrations and common state tests.

```bash
git add packages/document-core/src/v2/templates/bids/enterprise-services.ts packages/document-core/src/v2/templates/index.ts packages/document-core/tests/bid-templates-v2.test.ts packages/document-core/tests/fixtures/v2/bid-enterprise-services.json
git commit -m "feat: add enterprise services bid template"
```

- [ ] **Step 9: Prove registration completeness and uniqueness**

Add this assertion to `bid-templates-v2.test.ts`:

```ts
it("registers exactly fourteen new immutable template versions", () => {
  const definitions = V2_TEMPLATE_REGISTRY.list().map((registration) => registration.definition);
  expect(definitions).toHaveLength(14);
  expect(new Set(definitions.map((definition) => `${definition.id}@${definition.version}`)).size).toBe(14);
  expect(definitions.every((definition) => definition.basisDate === "2026-08-19")).toBe(true);
});
```

Run: `pnpm --filter @opentrad/document-core test && pnpm --filter @opentrad/document-core typecheck`

Expected: PASS; 14 V2 registrations plus the immutable V1 standard quote cover all 15 launch templates.

### Task 15: Store V2 drafts and attachments and package them as bounded ZIP projects

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/features/quotation/storage/repository.ts`
- Modify: `apps/web/src/features/quotation/storage/repository.test.ts`
- Create: `apps/web/src/features/documents/storage/attachmentValidation.ts`
- Create: `apps/web/src/features/documents/storage/documentRepository.ts`
- Create: `apps/web/src/features/documents/project/projectV2Files.ts`
- Test: `apps/web/src/features/documents/storage/attachmentValidation.test.ts`
- Test: `apps/web/src/features/documents/storage/documentRepository.test.ts`
- Test: `apps/web/src/features/documents/project/projectV2Files.test.ts`

- [ ] **Step 1: Write database-upgrade and attachment RED tests**

```ts
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { V2_TEMPLATE_REGISTRY } from "@opentrad/document-core";
import { createDocumentRepository } from "./documentRepository";
import { validateAttachmentBytes } from "./attachmentValidation";

function createServiceQuoteEnvelopeFixture() {
  const registration = V2_TEMPLATE_REGISTRY.get("quotation.service.project.v1", "1.0.0");
  const draft = registration.createDraft({ id: "service-quote-1", now: "2026-08-19T10:00:00.000Z" });
  return {
    formatVersion: "2.0.0" as const,
    template: { id: "quotation.service.project.v1", version: "1.0.0", basisDate: "2026-08-19" as const },
    draft,
    presentation: { layoutStyleId: "modern-business.v1" as const, languageView: "zh-CN" as const },
    attachmentManifest: [],
  };
}

describe("V2 local documents", () => {
  it("preserves V1 stores while saving a version-keyed V2 document", async () => {
    const repository = createDocumentRepository({ databaseName: "opentrad-v2-upgrade-test" });
    const stored = await repository.save({
      envelope: createServiceQuoteEnvelopeFixture(),
      savedAt: "2026-08-19T10:00:00.000Z",
      makeCurrent: true,
    });
    expect(stored.key).toBe("quotation.service.project.v1@1.0.0:service-quote-1");
    expect((await repository.getCurrent())?.envelope.template.version).toBe("1.0.0");
    repository.close();
  });

  it("checks MIME signatures instead of trusting a filename", () => {
    const fakePdf = new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]);
    expect(() => validateAttachmentBytes(fakePdf, "application/pdf")).toThrow("附件内容与类型不一致");
  });
});
```

- [ ] **Step 2: Write ZIP import/export RED tests**

```ts
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { exportProjectV2Zip, importProjectV2Zip } from "./projectV2Files";

function buildMaliciousZip(path: string): Blob {
  return new Blob([zipSync({ [path]: new TextEncoder().encode("%PDF-1.7\n%%EOF") })]);
}

function buildOversizedStreamingZip(byteLength: number): Blob {
  const bytes = new Uint8Array(byteLength);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  return new Blob([zipSync({ "attachments/oversized.pdf": bytes }, { level: 1 })]);
}

describe(".opentrad V2 ZIP", () => {
  it("round-trips manifest, draft and local attachments", async () => {
    const blob = await exportProjectV2Zip({
      envelope: createServiceQuoteEnvelopeFixture(),
      attachments: [{ id: "attachment-1", mediaType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF") }],
    });
    const parsed = await importProjectV2Zip(blob);
    expect(parsed.envelope.formatVersion).toBe("2.0.0");
    expect(parsed.attachments[0]?.id).toBe("attachment-1");
  });

  it("rejects traversal and aggregate data above 50 MiB", async () => {
    await expect(importProjectV2Zip(buildMaliciousZip("../escape.pdf"))).rejects.toThrow("项目包路径不安全");
    await expect(importProjectV2Zip(buildOversizedStreamingZip(52_428_801))).rejects.toThrow("项目包附件超过 50 MiB");
  });
});
```

- [ ] **Step 3: Run the storage and ZIP tests to verify RED**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/storage src/features/documents/project`

Expected: FAIL because the V2 repository, attachment validation and ZIP functions are missing.

- [ ] **Step 4: Add the exact ZIP dependency**

Run: `pnpm --filter @opentrad/web add fflate@0.8.3 --save-exact`

Expected: `apps/web/package.json` contains `"fflate": "0.8.3"` and the lockfile resolves only that version.

- [ ] **Step 5: Upgrade IndexedDB additively to version 2**

```ts
export const QUOTATION_DATABASE_VERSION = 2;
export const DOCUMENTS_V2_STORE = "documentsV2";
export const ATTACHMENTS_STORE = "attachments";

export interface StoredDocumentV2 {
  key: string;
  documentId: string;
  templateId: string;
  templateVersion: string;
  envelope: ProjectEnvelopeV2;
  revision: number;
  savedAt: string;
}

export interface StoredAttachmentV1 {
  id: string;
  documentKey: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg";
  byteLength: number;
  pageCount?: number;
  blob: Blob;
  savedAt: string;
}
```

In the existing `upgradeDatabase`, retain `companyProfiles`, `drafts` and `meta` untouched. Add `documentsV2` with key path `key` and indexes `by-saved-at`, `by-template`, and `by-document-id`; add `attachments` with key path `id` and index `by-document-key`. Extend `clearAllLocalData` to clear both new stores in the same transaction.

- [ ] **Step 6: Implement version-keyed document CRUD**

```ts
export function documentStorageKey(envelope: ProjectEnvelopeV2): string {
  return `${envelope.template.id}@${envelope.template.version}:${envelope.draft.id}`;
}

export interface DocumentRepositoryV2 {
  save(input: { envelope: unknown; savedAt: string; makeCurrent: boolean }): Promise<StoredDocumentV2>;
  get(key: string): Promise<StoredDocumentV2 | null>;
  getCurrent(): Promise<StoredDocumentV2 | null>;
  list(): Promise<StoredDocumentV2[]>;
  delete(key: string): Promise<void>;
  putAttachment(record: StoredAttachmentV1): Promise<void>;
  listAttachments(documentKey: string): Promise<StoredAttachmentV1[]>;
  deleteAttachment(id: string): Promise<void>;
  close(): void;
}
```

`save` parses with `parseOpenTradProject(serializeProjectV2(input.envelope))`, increments revision atomically and writes a separate meta pointer `current-document-v2`. Deleting a document deletes its attachments in the same read-write transaction. Await every request and `transaction.done`.

- [ ] **Step 7: Implement attachment limits and signatures**

```ts
export const MAX_STANDARD_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_BID_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_BID_ATTACHMENT_PAGES = 80;

export function validateAttachmentBytes(bytes: Uint8Array, mediaType: StoredAttachmentV1["mediaType"]): void {
  const matches =
    (mediaType === "application/pdf" && new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-") ||
    (mediaType === "image/png" && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) ||
    (mediaType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9);
  if (!matches) throw new Error("附件内容与类型不一致");
}
```

Count aggregate bytes and pages before transaction commit. Reject SVG, HTML, Office macros, executables, data URLs, empty files and unknown MIME types.

- [ ] **Step 8: Implement streaming `.opentrad` ZIP import/export**

Archive layout is fixed:

```text
manifest.json
draft.json
attachments/<attachment-id>.pdf
attachments/<attachment-id>.png
attachments/<attachment-id>.jpg
```

`manifest.json` contains format version, exact template identity, presentation and attachment descriptors. `draft.json` contains the validated envelope without Blob data. Use `fflate` streaming `Zip`/`Unzip`; accept only exact normalized paths, reject backslashes, leading slash, `..`, duplicate entries, symbolic-link metadata, more than 202 entries, an entry above 25 MiB and cumulative attachment bytes above 50 MiB. Re-run `parseOpenTradProject`, manifest-to-draft identity checks and MIME signatures after decompression.

- [ ] **Step 9: Run all local storage and project tests**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/quotation/storage src/features/quotation/project src/features/documents/storage src/features/documents/project`

Expected: PASS; V1 drafts survive the database version upgrade and V2 ZIP traversal/oversize cases fail with the specified Chinese errors.

- [ ] **Step 10: Commit storage and project V2**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/quotation/storage apps/web/src/features/documents/storage apps/web/src/features/documents/project
git commit -m "feat: store versioned documents and project attachments"
```

### Task 16: Replace the preview catalogue with 15 registered template entries

**Files:**
- Modify: `apps/web/src/data/templates.ts`
- Modify: `apps/web/src/pages/TemplatesPage.tsx`
- Modify: `apps/web/src/pages/TemplateDetailPage.tsx`
- Test: `apps/web/src/pages/TemplatesPage.test.tsx`
- Test: `apps/web/src/pages/TemplateDetailPage.test.tsx`

- [ ] **Step 1: Write template-centre RED tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TemplatesPage } from "./TemplatesPage";
import { TemplateDetailPage } from "./TemplateDetailPage";

describe("15-template catalogue", () => {
  it("shows five quotations, five contracts and five bids", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/templates"]}><TemplatesPage /></MemoryRouter>);
    expect(screen.getByText("15 个模板")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /合同.*5/u }));
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /标书.*5/u }));
    expect(screen.getAllByRole("link", { name: /使用模板/u })).toHaveLength(5);
  });

  it("shows exact version, basis date, sources and non-advice warning", () => {
    render(
      <MemoryRouter initialEntries={["/templates/contract.service.commercial.v1"]}>
        <Routes><Route path="/templates/:templateId" element={<TemplateDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("版本 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("依据审阅日期 2026-08-19")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "委托合同（GF—2025—1001）" })).toHaveAttribute(
      "href",
      "https://htsfwb.samr.gov.cn/View?id=50b57729-0fca-45d2-92c3-fe7e6a989815",
    );
    expect(screen.getByText(/不构成法律、税务、会计或投标代理意见/u)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run page tests to verify RED**

Run: `pnpm --filter @opentrad/web exec vitest run src/pages/TemplatesPage.test.tsx src/pages/TemplateDetailPage.test.tsx`

Expected: FAIL because the catalogue still contains eight preview entries and V2 source metadata is not rendered.

- [ ] **Step 3: Define the complete catalogue adapter**

```ts
export type TemplateCategoryLabel = "报价单" | "合同" | "标书";

export interface DocumentTemplateCard {
  id: string;
  version: string;
  title: string;
  category: TemplateCategoryLabel;
  format: "A4";
  description: string;
  accent: "green" | "blue" | "copper";
  editorPath: string;
  basisDate: string;
  languages: readonly string[];
  defaultLayout: LayoutStyleId;
  sourceKeys: readonly OfficialSourceKey[];
  disclaimerProfile: TemplateDefinitionV2["disclaimerProfile"];
}

const V1_STANDARD_CARD: DocumentTemplateCard = {
  id: "quotation.goods.standard.v1",
  version: "1.0.0",
  title: "标准货物报价单",
  category: "报价单",
  format: "A4",
  description: "适用于常规商品询报价，支持精确税额、折扣和本地导出。",
  accent: "green",
  editorPath: "/editor/standard-goods-quote",
  basisDate: "2026-08-19",
  languages: ["zh-CN"],
  defaultLayout: "classic-formal.v1",
  sourceKeys: ["samr-contract-library"],
  disclaimerProfile: "quotation",
};

export const templates = Object.freeze([
  V1_STANDARD_CARD,
  ...V2_TEMPLATE_REGISTRY.list().map(({ definition }) => ({
    id: definition.id,
    version: definition.version,
    title: definition.name,
    category: ({ quotation: "报价单", contract: "合同", bid: "标书" } as const)[definition.category],
    format: "A4" as const,
    description: definition.summary,
    accent: definition.category === "bid" ? "copper" as const : definition.category === "contract" ? "blue" as const : "green" as const,
    editorPath: `/editor/${definition.id}`,
    basisDate: definition.basisDate,
    languages: definition.languages,
    defaultLayout: definition.defaultLayout,
    sourceKeys: definition.sourceKeys,
    disclaimerProfile: definition.disclaimerProfile,
  })),
]);
```

- [ ] **Step 4: Implement category/language/search filters and detail evidence**

Remove the unrelated invoice and packing-list preview categories. Category counts must derive from `templates`, not hard-coded integers. Add language filter `全部语言 / 中文 / 中英双语`. Search includes title, description and category. Every card has a real editor route.

The detail page resolves official source descriptors from `OFFICIAL_SOURCES`, opens source links in a new tab with `rel="noreferrer"`, shows the exact version/basis date/default layout/languages, and displays these fixed warnings:

```ts
const DISCLAIMER_COPY = {
  quotation: "本工具生成报价结构，不构成法律、税务或会计意见。",
  contract: "本工具生成合同草案，不构成法律意见；签署前应由当事人自行审阅。",
  international: "本工具不判断 Incoterms、CISG、适用法、税则或语言优先的正确选择。",
  bid: "本工具不保证投标合规或中标；最终内容必须逐项对应招标文件及全部澄清版本。",
} as const;
```

- [ ] **Step 5: Assert every template has a non-empty field manifest**

Add to `TemplatesPage.test.tsx`:

```ts
it("exposes a unique form field manifest for every V2 template", () => {
  for (const registration of V2_TEMPLATE_REGISTRY.list()) {
    expect(registration.definition.fieldManifest.length).toBeGreaterThan(5);
    const paths = registration.definition.fieldManifest.map((field) => field.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).not.toContain("id");
    expect(paths).not.toContain("templateId");
    expect(paths).not.toContain("templateVersion");
    expect(paths).not.toContain("updatedAt");
  }
});
```

Run: `pnpm --filter @opentrad/web exec vitest run src/pages/TemplatesPage.test.tsx src/pages/TemplateDetailPage.test.tsx`

Expected: PASS with 15 templates and no unavailable/editor-placeholder state.

- [ ] **Step 6: Commit the complete template centre**

```bash
git add apps/web/src/data/templates.ts apps/web/src/pages/TemplatesPage.tsx apps/web/src/pages/TemplateDetailPage.tsx apps/web/src/pages/TemplatesPage.test.tsx apps/web/src/pages/TemplateDetailPage.test.tsx
git commit -m "feat: publish complete local template catalogue"
```

### Task 17: Integrate a manifest-driven local editor, preview and exports

**Files:**
- Create: `apps/web/src/features/documents/editor/fieldPaths.ts`
- Create: `apps/web/src/features/documents/editor/SchemaForm.tsx`
- Create: `apps/web/src/features/documents/editor/DocumentPreviewPanel.tsx`
- Create: `apps/web/src/features/documents/editor/ExportPanel.tsx`
- Create: `apps/web/src/features/documents/editor/BidPreflightPanel.tsx`
- Create: `apps/web/src/features/documents/editor/DocumentEditorPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/documents/editor/DocumentEditorPage.test.tsx`
- Test: `apps/web/src/features/documents/editor/BidPreflightPanel.test.tsx`

- [ ] **Step 1: Write safe field-path RED tests**

```ts
import { describe, expect, it } from "vitest";
import { setDraftField } from "./fieldPaths";

describe("manifest field updates", () => {
  it("updates a copied nested draft without mutating the source", () => {
    const source = { project: { projectName: "旧名称" }, lineItems: [{ name: "商品一" }] };
    const updated = setDraftField(source, "project.projectName", "新名称");
    expect(updated.project.projectName).toBe("新名称");
    expect(source.project.projectName).toBe("旧名称");
  });

  it.each(["__proto__.polluted", "constructor.prototype.polluted", "prototype.value"])(
    "rejects dangerous path %s",
    (path) => expect(() => setDraftField({}, path, true)).toThrow("字段路径不安全"),
  );
});
```

- [ ] **Step 2: Write editor-flow and bid-preflight RED tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DocumentEditorPage } from "./DocumentEditorPage";

describe("generic V2 document editor", () => {
  it("creates, edits, previews and saves a service quote locally", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/editor/quotation.service.project.v1"]}>
        <Routes><Route path="/editor/:templateId" element={<DocumentEditorPage />} /></Routes>
      </MemoryRouter>,
    );
    await user.clear(screen.getByLabelText("项目名称"));
    await user.type(screen.getByLabelText("项目名称"), "工厂节能改造咨询");
    expect(await screen.findByText("工厂节能改造咨询", { selector: ".document-preview-v2 *" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("已保存到本机")).toBeInTheDocument());
  });

  it("does not offer a submission export for an unbound bid", async () => {
    render(
      <MemoryRouter initialEntries={["/editor/bid.government.goods.v1"]}>
        <Routes><Route path="/editor/:templateId" element={<DocumentEditorPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/内部投标底稿/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载提交版 PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下载内部底稿 PDF" })).toBeEnabled();
  });

  it("keeps every document export local", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    render(
      <MemoryRouter initialEntries={["/editor/contract.sale.domestic-b2b.v1"]}>
        <Routes><Route path="/editor/:templateId" element={<DocumentEditorPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("所有文书内容仅保存在当前设备")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run editor tests to verify RED**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/editor`

Expected: FAIL because the generic editor components do not exist.

- [ ] **Step 4: Implement immutable safe-path updates**

```ts
const SAFE_SEGMENT = /^(?:[A-Za-z][A-Za-z0-9_-]*|0|[1-9]\d*)$/u;
const DANGEROUS_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function setDraftField<T>(source: T, path: string, value: unknown): T {
  const segments = path.split(".");
  if (
    segments.length === 0 ||
    segments.length > 12 ||
    segments.some((segment) => !SAFE_SEGMENT.test(segment) || DANGEROUS_SEGMENTS.has(segment))
  ) {
    throw new Error("字段路径不安全");
  }
  return copyWithPath(source, segments, value);
}

function copyWithPath<T>(source: T, segments: readonly string[], value: unknown): T {
  const [head, ...tail] = segments;
  if (head === undefined) return value as T;
  const sourceRecord = source !== null && typeof source === "object" ? source as Record<string, unknown> : Object.create(null) as Record<string, unknown>;
  const numericIndex = /^(?:0|[1-9]\d*)$/u.test(head) ? Number(head) : null;
  if (numericIndex !== null) {
    if (numericIndex > 499) throw new Error("字段路径不安全");
    const copy = Array.isArray(source) ? source.slice() : [];
    copy[numericIndex] = copyWithPath(copy[numericIndex], tail, value);
    return copy as T;
  }
  const copy = Object.assign(Object.create(null) as Record<string, unknown>, sourceRecord);
  copy[head] = copyWithPath(sourceRecord[head], tail, value);
  return copy as T;
}
```

- [ ] **Step 5: Implement manifest controls without free-form HTML**

`SchemaForm` maps every manifest `control` to one concrete native control:

```tsx
switch (field.control) {
  case "text":
  case "money":
  case "percent":
  case "number": return <input aria-label={field.label} inputMode={field.control === "money" || field.control === "percent" ? "decimal" : undefined} value={stringValue} onChange={onTextChange} />;
  case "textarea": return <textarea aria-label={field.label} value={stringValue} onChange={onTextChange} />;
  case "date": return <input type="date" aria-label={field.label} value={stringValue} onChange={onTextChange} />;
  case "datetime": return <input type="datetime-local" aria-label={field.label} value={stringValue} onChange={onTextChange} />;
  case "select": return <select aria-label={field.label} value={stringValue} onChange={onTextChange}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  case "checkbox": return <input type="checkbox" aria-label={field.label} checked={Boolean(value)} onChange={onCheckboxChange} />;
  case "repeatable": return <RepeatableField field={field} value={arrayValue} onChange={onArrayChange} />;
  case "attachment": return <AttachmentField field={field} value={attachmentValue} onChange={onAttachmentChange} />;
  default: return assertNever(field.control);
}
```

Group controls by `field.section`, render required state, visible conditions, path-specific Zod issues with `aria-describedby`, and add/remove/reorder repeatable rows with stable IDs.

- [ ] **Step 6: Implement editor workspace and local autosave**

`DocumentEditorPage` resolves the exact `1.0.0` registration, creates or restores a V2 envelope, parses after every field change, compiles a preview only when valid, and otherwise displays the last valid preview plus current validation errors. Debounce saves by 400 ms through `DocumentRepositoryV2`; show `正在保存 / 已保存到本机 / 保存失败` states.

Desktop layout remains `steps + form + A4 preview`; under 900 px preview moves below; under 600 px use accessible `填写 / 预览` tabs. Layout and language selectors update `envelope.presentation`, not the draft schema. The UI always displays `所有文书内容仅保存在当前设备`.

- [ ] **Step 7: Implement local preview, exports and bid preflight**

`DocumentPreviewPanel` uses `DocumentHtml`. `ExportPanel` compiles once and passes the same model to DOCX/PDF/JSON. Project export uses `exportProjectV2Zip`. Safe filenames use template name, document number and export mode after removing control characters and path separators.

For contracts, show a separate `生成说明` preview page with the non-advice warning; it is not numbered as a contract clause. For bids, `BidPreflightPanel` lists finding code, message, source path and impact; internal/review downloads are labeled accordingly, and submission buttons render only when `canExportSubmission=true`.

- [ ] **Step 8: Add the generic route without changing the V1 route**

```tsx
<Route path="/editor/standard-goods-quote" element={<QuoteEditorPage />} />
<Route path="/editor/:templateId" element={<DocumentEditorPage />} />
```

The V1 route must stay above the parameter route. An unknown template renders a real “模板版本不存在” error and a link back to `/templates`; it must not redirect into the standard quotation editor.

- [ ] **Step 9: Run editor, route, V1 quotation and accessibility tests**

Run: `pnpm --filter @opentrad/web exec vitest run src/features/documents/editor src/features/quotation/editor src/App.test.tsx`

Expected: PASS; no new route changes the V1 quotation editor tests.

- [ ] **Step 10: Commit generic local editing**

```bash
git add apps/web/src/features/documents/editor apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add local editors for versioned templates"
```

### Task 18: Generate the 15-template gold matrix, run browser QA and enforce full release gates

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `tests/golds/templates-v2/manifest.json`
- Create by script: `tests/golds/templates-v2/artifacts/<template-id>/default.model.json`
- Create by script: `tests/golds/templates-v2/artifacts/<template-id>/default.docx`
- Create by script: `tests/golds/templates-v2/artifacts/<template-id>/default.pdf`
- Create: `scripts/generate-template-golds.mjs`
- Create: `scripts/verify-template-golds.mjs`
- Create: `apps/web/e2e/templates-v2.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Add the exact browser-test dependency and scripts**

Run: `pnpm --filter @opentrad/web add -D @playwright/test@1.62.1 --save-exact`

Add these root scripts:

```json
{
  "scripts": {
    "golds:generate": "node scripts/generate-template-golds.mjs",
    "golds:verify": "node scripts/verify-template-golds.mjs",
    "e2e": "pnpm --filter @opentrad/web exec playwright test"
  }
}
```

Expected: lockfile pins `@playwright/test` to `1.62.1` and existing scripts remain unchanged.

- [ ] **Step 2: Write the complete gold manifest before the generator**

```json
{
  "formatVersion": "1.0.0",
  "generatedWithBasisDate": "2026-08-19",
  "templates": [
    { "id": "quotation.goods.standard.v1", "version": "1.0.0", "layout": "modern-business.v1", "language": "zh-CN", "fixture": "standard-two-lines-tax-discount" },
    { "id": "quotation.service.project.v1", "version": "1.0.0", "layout": "modern-business.v1", "language": "zh-CN", "fixture": "three-services-three-milestones" },
    { "id": "quotation.oem.custom.v1", "version": "1.0.0", "layout": "modern-business.v1", "language": "zh-CN", "fixture": "tooling-nre-sample-materials" },
    { "id": "quotation.export.bilingual.v1", "version": "1.0.0", "layout": "international-compact.v1", "language": "zh-en", "fixture": "fca-two-goods-bilingual" },
    { "id": "quotation.proforma.invoice.v1", "version": "1.0.0", "layout": "international-compact.v1", "language": "zh-en", "fixture": "weights-freight-insurance" },
    { "id": "contract.sale.domestic-b2b.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "staged-payment-inspection-risk" },
    { "id": "contract.supply.framework.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "nonbinding-forecast-order-priority" },
    { "id": "contract.oem.processing.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "principal-materials-tooling-ip" },
    { "id": "contract.service.commercial.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "delegation-acceptance-termination" },
    { "id": "contract.sale.international-bilingual.v1", "version": "1.0.0", "layout": "international-compact.v1", "language": "zh-en", "fixture": "cip-cisg-arbitration-bilingual" },
    { "id": "bid.government.goods.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "complete-source-core-product" },
    { "id": "bid.government.services.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "method-team-sla-acceptance" },
    { "id": "bid.construction.works.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "manager-equipment-long-plan" },
    { "id": "bid.enterprise.goods.v1", "version": "1.0.0", "layout": "classic-formal.v1", "language": "zh-CN", "fixture": "technical-commercial-matrix" },
    { "id": "bid.enterprise.services.v1", "version": "1.0.0", "layout": "modern-business.v1", "language": "zh-CN", "fixture": "solution-team-risks-exclusions" }
  ]
}
```

- [ ] **Step 3: Write a RED gold verifier test mode**

`scripts/verify-template-golds.mjs` must exit non-zero before artifacts exist and print exactly `Missing 45 required default gold artifacts`. It loads the manifest, requires model/DOCX/PDF for each entry, and rejects extra template directories.

Run: `pnpm golds:verify`

Expected: FAIL with `Missing 45 required default gold artifacts`.

- [ ] **Step 4: Implement deterministic artifact generation**

`scripts/generate-template-golds.mjs` loads each committed JSON fixture, parses/compiles through the exact registration, and writes normalized model JSON, DOCX and PDF to the manifest path. The existing V1 standard quote uses its current fixture/compiler. Before writing, remove only files under the explicit `tests/golds/templates-v2/artifacts` directory; validate that resolved path begins with the repository gold root.

The script sets fixed document metadata dates to `2026-08-19T00:00:00.000Z`, uses the manifest layout/language, rejects any preflight `blockSubmission`, and asserts exactly 15 model, 15 DOCX and 15 PDF outputs.

Run: `pnpm golds:generate`

Expected: PASS with `Generated 45 default gold artifacts for 15 templates`.

- [ ] **Step 5: Implement DOCX, PDF and semantic gold verification**

For every DOCX, the verifier runs ZIP integrity and parses every XML part. It rejects external relationships, macros, `altChunk`, embedded objects, duplicate ZIP paths and traversal; asserts A4 dimensions, margins, page-number fields, repeated table headers and `w:updateFields`. It converts through LibreOffice to PDF, then renders every page to PNG for later visual review.

For every PDF, it runs `pdfinfo`, `pdffonts`, `pdftotext -layout` and `pdftoppm -png -r 144`. Assert A4 portrait pages except declared landscape sections, all fonts `emb=yes`, Chinese text extractable, expected title/parties/totals present and no text bounding box outside the media box.

For every template, compare normalized DOCX XML text and PDF extracted text against `semanticTextDigest(default.model.json)`. Allow renderer-specific page numbers and TOC fields, but no missing user field, amount, clause, disclaimer or watermark.

Run: `pnpm golds:verify`

Expected: PASS with `Verified 15 models, 15 DOCX files and 15 PDF files`.

- [ ] **Step 6: Add cross-layout and conditional gold assertions**

The verifier additionally builds render plans for all 15 templates under all three profiles and asserts identical semantic digests. Generate full three-profile DOCX/PDF artifacts for:

- `quotation.goods.standard.v1`
- `contract.sale.international-bilingual.v1`
- `bid.enterprise.services.v1`

Compile conditional fixtures for CIF/CIP insurance, PFI declaration, framework non-binding forecast, OEM materials/tooling, service personal data, CISG undecided, missing bid source, unanswered substantial requirement and construction personnel/equipment. Assert each exact finding code and export impact.

Run: `pnpm --filter @opentrad/document-core exec vitest run tests/template-compiler-golds.test.ts && pnpm golds:verify`

Expected: PASS with three semantic digests per template and the nine conditional rule families green.

- [ ] **Step 7: Write real desktop and mobile Playwright flows**

`apps/web/e2e/templates-v2.spec.ts` must cover:

```ts
import { expect, test } from "@playwright/test";

test("service quote survives refresh and exports locally", async ({ page }) => {
  await page.goto("/opentrad-web/editor/quotation.service.project.v1");
  await page.getByLabel("项目名称").fill("工厂节能改造咨询");
  await expect(page.getByText("已保存到本机")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("项目名称")).toHaveValue("工厂节能改造咨询");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PDF" }).click();
  await expect((await download).suggestedFilename()).toMatch(/项目服务报价.*\.pdf$/u);
});

test("unbound bid can export only a marked internal draft", async ({ page }) => {
  await page.goto("/opentrad-web/editor/bid.government.goods.v1");
  await expect(page.getByText(/内部投标底稿/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "下载提交版 PDF" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载内部底稿 PDF" })).toBeEnabled();
});

test.describe("mobile editor", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("switches between form and A4 preview without horizontal overflow", async ({ page }) => {
    await page.goto("/opentrad-web/editor/contract.sale.domestic-b2b.v1");
    await page.getByRole("tab", { name: "预览" }).click();
    await expect(page.getByLabel("文档预览")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
```

- [ ] **Step 8: Run browser tests at desktop, 900 px and phone sizes**

Run: `pnpm build && pnpm e2e`

Expected: PASS for anonymous creation, autosave, refresh recovery, DOCX/PDF/JSON/ZIP downloads, ZIP import, layout switch, bilingual preview, bid watermark, submission blocking, attachment deletion and clear-all data.

- [ ] **Step 9: Update CI and public documentation**

CI order is fixed:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm audit --audit-level=high
- run: pnpm lint
- run: pnpm typecheck
- run: pnpm test
- run: pnpm build
- run: pnpm golds:verify
- run: pnpm exec playwright install --with-deps chromium
- run: pnpm e2e
- run: git diff --check
```

README must list the 15 exact template names, explain V1/V2 project compatibility, state that documents and attachments stay local in this phase, state that no AI or paid service is used, and reproduce the non-advice/non-guarantee boundaries without claiming official status.

- [ ] **Step 10: Run full release gates from a clean checkout**

Run:

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm golds:verify
pnpm e2e
git diff --check
git status --short
```

Expected: every command exits 0; audit reports no high/critical vulnerabilities; 15 template models and 30 default office artifacts verify; Playwright passes; `git diff --check` is silent; `git status --short` lists only the intended implementation and gold files before commit.

- [ ] **Step 11: Commit golds, CI and documentation**

```bash
git add apps/web/package.json pnpm-lock.yaml tests/golds scripts apps/web/e2e .github/workflows/ci.yml README.md
git commit -m "test: verify all opentrad launch templates"
```

- [ ] **Step 12: Perform final V1/V2 release comparison**

Run:

```bash
git diff origin/main...HEAD -- packages/document-core/src/schemas.ts packages/document-core/src/compiler.ts packages/document-core/src/project.ts
pnpm --filter @opentrad/document-core exec vitest run tests/v1-compatibility.test.ts tests/project.test.ts tests/compiler.test.ts
```

Expected: the diff for the three immutable V1 source files is empty; every V1 test passes. If a necessary shared security fix touched one of those files, it requires a separate reviewed compatibility commit and byte-equivalent V1 outputs before release.

---

## Plan self-review

### Spec coverage

- V1 immutability and version coexistence: Tasks 1–4 and Task 18 Step 12.
- Registry, ProjectEnvelopeV2, DocumentModelV2 and official basis dates: Tasks 2–4.
- Three presentation profiles: Task 5.
- HTML, DOCX and PDF V2 rendering: Tasks 6–8.
- Four remaining quotation templates: Tasks 9–10.
- Five contract templates: Tasks 11–12.
- Five bid templates, source version, watermark and export state: Tasks 13–14.
- Attachment storage and ZIP `.opentrad` packages: Task 15.
- 15-template centre and generic local editor: Tasks 16–17.
- Default and conditional golds, desktop/mobile E2E, CI and release gates: Task 18.

No server conversion, authentication, AI, legal review, automatic translation, automatic qualification claim, HS-code decision, tax-rate decision or bid-compliance guarantee is introduced by this plan.

### Placeholder scan

Run after every plan edit:

```bash
rg -n "TO[D]O|TB[D]|implement late[r]|fill in detail[s]|similar to Tas[k]|appropriate error handlin[g]|write tests for the abov[e]" docs/superpowers/plans/2026-08-19-opentrad-templates-v2.md
```

Expected: no matches.

### Type and naming consistency

- Template identity is always `templateId` plus semantic `templateVersion`; definition metadata uses `{ id, version }` only at its boundary.
- All 14 new templates use `version: "1.0.0"` and `basisDate: "2026-08-19"`; V1 remains `quotation.goods.standard.v1@1.0.0`.
- Layout identifiers are exactly `classic-formal.v1`, `modern-business.v1`, and `international-compact.v1` in core, project files, UI and gold manifest.
- Language identifiers are exactly `zh-CN`, `en-US`, and `zh-en`.
- Monetary values remain minor-unit integer strings; quantities remain bounded decimal strings; rates remain integer basis points.
- `RiskFindingV2.impact`, `BidExportDecisionV1.mode`, and rendered watermarks use the same three-state policy throughout core, UI and tests.
- Attachments are referenced by ID in core/AST, stored as Blob records in IndexedDB, and serialized as bounded ZIP entries; no data URL enters a draft or AST.
- V2 HTML, DOCX and PDF consume the same `DocumentModelV2`; presentation profiles never alter the semantic digest.

### Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-opentrad-templates-v2.md`. Two execution options:

1. Subagent-Driven (recommended) — dispatch a fresh implementation subagent per task and run specification review then code-quality review between tasks.
2. Inline Execution — execute tasks in this session with `superpowers:executing-plans`, in the four checkpoints defined at the top.
