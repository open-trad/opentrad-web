import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const FIXED_INSTANT = "2026-08-19T00:00:00.000Z";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(repositoryRoot, "apps/web");
const goldRoot = join(repositoryRoot, "tests/golds/templates-v2");
const artifactsRoot = join(goldRoot, "artifacts");
const manifest = JSON.parse(readFileSync(join(goldRoot, "manifest.json"), "utf8"));
const requireFromWeb = createRequire(join(webRoot, "package.json"));
const { chromium } = requireFromWeb("@playwright/test");
const { createServer } = await import(
  new URL("../apps/web/node_modules/vite/dist/node/index.js", import.meta.url)
);

const fixtureFileByTemplateId = {
  "quotation.goods.standard.v1": join(goldRoot, "fixtures/standard-two-lines-tax-discount.json"),
  "quotation.service.project.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/quotation-service-project.json",
  ),
  "quotation.oem.custom.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/quotation-oem-custom.json",
  ),
  "quotation.export.bilingual.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/quotation-export-bilingual.json",
  ),
  "quotation.proforma.invoice.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/quotation-proforma-invoice.json",
  ),
  "contract.sale.domestic-b2b.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/contract-domestic-sale.json",
  ),
  "contract.supply.framework.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/contract-framework-supply.json",
  ),
  "contract.oem.processing.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/contract-oem-processing.json",
  ),
  "contract.service.commercial.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/contract-commercial-service.json",
  ),
  "contract.sale.international-bilingual.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/contract-international-sale.json",
  ),
  "bid.government.goods.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/bid-government-goods.json",
  ),
  "bid.government.services.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/bid-government-services.json",
  ),
  "bid.construction.works.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/bid-construction-works.json",
  ),
  "bid.enterprise.goods.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/bid-enterprise-goods.json",
  ),
  "bid.enterprise.services.v1": join(
    repositoryRoot,
    "packages/document-core/tests/fixtures/v2/bid-enterprise-services.json",
  ),
};

function assertSafeArtifactsRoot() {
  const relativePath = relative(goldRoot, artifactsRoot);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(goldRoot, relativePath) !== artifactsRoot
  ) {
    throw new Error("Refusing to clean an unsafe gold artifact path");
  }
}

function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Browser returned an invalid artifact payload");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

execFileSync("pnpm", ["--filter", "@opentrad/document-core", "build"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

assertSafeArtifactsRoot();
rmSync(artifactsRoot, { force: true, recursive: true });
mkdirSync(artifactsRoot, { recursive: true });

const server = await createServer({
  root: webRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
let browser;

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Gold Vite server did not start");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(
    ({ fixedInstant }) => {
      const NativeDate = Date;
      const fixedTime = NativeDate.parse(fixedInstant);
      class FixedDate extends NativeDate {
        constructor(...arguments_) {
          super(...(arguments_.length === 0 ? [fixedTime] : arguments_));
        }

        static now() {
          return fixedTime;
        }
      }
      Object.defineProperty(globalThis, "Date", { configurable: true, value: FixedDate });
    },
    { fixedInstant: FIXED_INSTANT },
  );
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });

  let modelCount = 0;
  let docxCount = 0;
  let pdfCount = 0;
  for (const template of manifest.templates) {
    const fixturePath = fixtureFileByTemplateId[template.id];
    if (!fixturePath) throw new Error(`No committed fixture for ${template.id}`);
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const generated = await page.evaluate(
      async ({
        coreModuleUrl,
        fixtureInput,
        fixedInstant,
        language,
        layout,
        templateId,
        templateVersion,
      }) => {
        const core = await import(coreModuleUrl);
        const blobToDataUrl = (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
            reader.addEventListener("error", () => reject(reader.error), { once: true });
            reader.readAsDataURL(blob);
          });

        let model;
        let docx;
        let pdf;
        if (templateId === "quotation.goods.standard.v1") {
          const draft = core.parseDocumentDraft(fixtureInput);
          model = core.compileStandardGoodsQuote(draft);
          const docxRenderer = await import("/src/features/quotation/export/docx/renderDocx.ts");
          const pdfRenderer = await import("/src/features/quotation/export/pdf/pdfmakeClient.ts");
          docx = await docxRenderer.renderDocxBlob(model);
          pdf = await pdfRenderer.renderPdfBlob(model);
        } else {
          const registration = core.v2.V2_TEMPLATE_REGISTRY.get(templateId, templateVersion);
          const draft = registration.parseDraft(fixtureInput);
          const findings = registration.preflight(draft, { asOf: fixedInstant });
          const blocking = findings.filter((finding) => finding.impact === "blockSubmission");
          if (blocking.length > 0) {
            throw new Error(
              `${templateId} has blocking preflight findings: ${blocking
                .map((finding) => finding.code)
                .join(",")}`,
            );
          }
          model = registration.compile(draft, { asOf: fixedInstant });
          const docxRenderer = await import("/src/features/documents/render/docx/renderDocxV2.ts");
          const pdfRenderer = await import("/src/features/documents/render/pdf/renderPdfV2.ts");
          docx = await docxRenderer.renderDocxV2(model, layout, language);
          pdf = await pdfRenderer.renderPdfV2(model, layout, language);
        }

        return {
          docx: await blobToDataUrl(docx),
          model: JSON.stringify(model, null, 2),
          pdf: await blobToDataUrl(pdf),
        };
      },
      {
        coreModuleUrl: `/@fs/${join(repositoryRoot, "packages/document-core/dist/index.js")}`,
        fixtureInput: fixture,
        fixedInstant: FIXED_INSTANT,
        language: template.language,
        layout: template.layout,
        templateId: template.id,
        templateVersion: template.version,
      },
    );

    const outputDirectory = join(artifactsRoot, template.id);
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, "default.model.json"), `${generated.model}\n`, "utf8");
    writeFileSync(join(outputDirectory, "default.docx"), decodeDataUrl(generated.docx));
    writeFileSync(join(outputDirectory, "default.pdf"), decodeDataUrl(generated.pdf));
    modelCount += 1;
    docxCount += 1;
    pdfCount += 1;
  }

  if (modelCount !== 15 || docxCount !== 15 || pdfCount !== 15) {
    throw new Error(
      `Generated unexpected artifact counts: ${modelCount} models, ${docxCount} DOCX, ${pdfCount} PDF`,
    );
  }
  console.log("Generated 45 default gold artifacts for 15 templates");
} finally {
  await browser?.close();
  await server.close();
}
