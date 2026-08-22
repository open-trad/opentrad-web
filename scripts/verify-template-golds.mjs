import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertExactOrientations,
  assertManifestMatrix,
  assertOrientationRuns,
  assertSemanticDigestText,
  collectStaticText,
} from "./gold-verification-helpers.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(repositoryRoot, "apps/web");
const goldRoot = join(repositoryRoot, "tests/golds/templates-v2");
const artifactsRoot = join(goldRoot, "artifacts");
const manifest = JSON.parse(readFileSync(join(goldRoot, "manifest.json"), "utf8"));
const requiredNames = ["default.model.json", "default.docx", "default.pdf"];
const expectedIds = new Set(manifest.templates.map((template) => template.id));
const layoutProfiles = ["classic-formal.v1", "modern-business.v1", "international-compact.v1"];
const fullCrossLayoutTemplateIds = new Set([
  "quotation.goods.standard.v1",
  "contract.sale.international-bilingual.v1",
  "bid.enterprise.services.v1",
]);
const requireFromWeb = createRequire(join(webRoot, "package.json"));
const { unzipSync } = requireFromWeb("fflate");

function fail(message) {
  throw new Error(message);
}

function run(binary, arguments_, options = {}) {
  try {
    return execFileSync(binary, arguments_, {
      encoding: options.encoding ?? "utf8",
      env: options.env,
      input: options.input,
      maxBuffer: 128 * 1024 * 1024,
      stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || "unknown failure";
    fail(`${binary} failed: ${detail}`);
  }
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/gu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function centralDirectoryNames(buffer) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  let eocd = -1;
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65_557);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) fail("DOCX has no ZIP end-of-central-directory record");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== centralSignature) fail("DOCX central directory is corrupt");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function assertDocxSecurity(docxPath, templateId) {
  run("unzip", ["-tqq", docxPath]);
  const bytes = readFileSync(docxPath);
  const names = centralDirectoryNames(bytes);
  if (new Set(names).size !== names.length) fail(`${templateId} DOCX has duplicate ZIP paths`);
  for (const name of names) {
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").some((segment) => segment === "..")
    ) {
      fail(`${templateId} DOCX has a traversal ZIP path: ${name}`);
    }
    if (/vbaProject\.bin|(^|\/)embeddings\//iu.test(name)) {
      fail(`${templateId} DOCX contains a macro or embedded object: ${name}`);
    }
  }

  const entries = unzipSync(new Uint8Array(bytes));
  for (const [name, contents] of Object.entries(entries)) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const xml = Buffer.from(contents).toString("utf8");
    const parsed = spawnSync("xmllint", ["--noout", "-"], {
      encoding: "utf8",
      input: xml,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (parsed.status !== 0) fail(`${templateId} has malformed XML part ${name}`);
    if (/TargetMode\s*=\s*["']External["']/iu.test(xml)) {
      fail(`${templateId} DOCX contains an external relationship in ${name}`);
    }
    if (/<w:altChunk\b|<w:object\b|macroEnabled|vbaProject/iu.test(xml)) {
      fail(`${templateId} DOCX contains active or embedded content in ${name}`);
    }
  }

  const documentXml = Buffer.from(entries["word/document.xml"] ?? []).toString("utf8");
  const settingsXml = Buffer.from(entries["word/settings.xml"] ?? []).toString("utf8");
  const footerXml = Object.entries(entries)
    .filter(([name]) => /^word\/footer\d+\.xml$/u.test(name))
    .map(([, contents]) => Buffer.from(contents).toString("utf8"))
    .join("\n");
  const pageSizes = [...documentXml.matchAll(/<w:pgSz\b([^>]*)\/?\s*>/gu)].map(
    (match) => match[1] ?? "",
  );
  if (pageSizes.length === 0) fail(`${templateId} DOCX has no page geometry`);
  for (const attributes of pageSizes) {
    const width = Number(/\bw:w="(\d+)"/u.exec(attributes)?.[1]);
    const height = Number(/\bw:h="(\d+)"/u.exec(attributes)?.[1]);
    if (!((width === 11_906 && height === 16_838) || (width === 16_838 && height === 11_906))) {
      fail(`${templateId} DOCX has a non-A4 section (${width}x${height})`);
    }
  }
  const margins = [...documentXml.matchAll(/<w:pgMar\b([^>]*)\/?\s*>/gu)];
  if (margins.length !== pageSizes.length)
    fail(`${templateId} DOCX section margins are incomplete`);
  for (const margin of margins) {
    for (const side of ["top", "right", "bottom", "left"]) {
      const value = Number(new RegExp(`\\bw:${side}="(\\d+)"`, "u").exec(margin[1] ?? "")?.[1]);
      if (!Number.isInteger(value) || value < 360 || value > 2_880) {
        fail(`${templateId} DOCX has an invalid ${side} margin`);
      }
    }
  }
  if (!/<w:tblHeader\b/gu.test(documentXml))
    fail(`${templateId} DOCX has no repeated table header`);
  if (!/<w:updateFields\b/gu.test(settingsXml)) fail(`${templateId} DOCX does not update fields`);
  if (!/PAGE|NUMPAGES/gu.test(footerXml)) fail(`${templateId} DOCX has no page-number fields`);

  const xmlText = Object.entries(entries)
    .filter(([name]) => name.startsWith("word/") && name.endsWith(".xml"))
    .flatMap(([, contents]) => {
      const xml = Buffer.from(contents).toString("utf8");
      return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map((match) =>
        decodeXml(match[1] ?? ""),
      );
    })
    .join(" ");
  return {
    orientations: pageSizes.map((attributes) => {
      const width = Number(/\bw:w="(\d+)"/u.exec(attributes)?.[1]);
      const height = Number(/\bw:h="(\d+)"/u.exec(attributes)?.[1]);
      return width > height ? "landscape" : "portrait";
    }),
    xmlText,
  };
}

function assertEmbeddedFonts(output, templateId) {
  const fontRows = output
    .split(/\r?\n/u)
    .slice(2)
    .filter((line) => line.trim().length > 0);
  if (fontRows.length === 0) fail(`${templateId} PDF has no fonts`);
  for (const row of fontRows) {
    if (!/\s+yes\s+(?:yes|no)\s+(?:yes|no)\s+\d+\s+\d+\s*$/u.test(row)) {
      fail(`${templateId} PDF contains a non-embedded font: ${row.trim()}`);
    }
  }
}

function assertA4Pdf(info, templateId, declaredOrientations) {
  const sizes = [...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/gu)];
  const declaredPages = Number(/^Pages:\s+(\d+)$/mu.exec(info)?.[1]);
  if (sizes.length === 0 || sizes.length !== declaredPages) {
    fail(`${templateId} PDF page geometry is incomplete`);
  }
  const actualOrientations = sizes.map((size) => {
    const width = Number(size[1]);
    const height = Number(size[2]);
    const portrait = Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1;
    const landscape = Math.abs(width - 841.89) < 0.1 && Math.abs(height - 595.28) < 0.1;
    if (!portrait && !landscape) fail(`${templateId} PDF contains a non-A4 page`);
    return landscape ? "landscape" : "portrait";
  });
  assertOrientationRuns(actualOrientations, declaredOrientations, `${templateId} PDF`);
  return { orientations: actualOrientations, pageCount: declaredPages };
}

function assertBoundingBoxes(bboxXml, templateId) {
  const pages = [
    ...bboxXml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/gu),
  ];
  if (pages.length === 0) fail(`${templateId} PDF has no text bounding boxes`);
  for (const page of pages) {
    const width = Number(page[1]);
    const height = Number(page[2]);
    for (const word of (page[3] ?? "").matchAll(
      /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">/gu,
    )) {
      const [xMin, yMin, xMax, yMax] = word.slice(1).map(Number);
      if (xMin < -0.75 || yMin < -0.75 || xMax > width + 0.75 || yMax > height + 0.75) {
        fail(`${templateId} PDF has text outside its media box`);
      }
    }
  }
}

function assertSemanticDigest(digest, renderedText, templateId, format) {
  assertSemanticDigestText(digest, renderedText, `${templateId} ${format}`);
}

function renderPdfPages(pdfPath, outputPrefix, expectedPages) {
  run("pdftoppm", ["-png", "-r", "144", pdfPath, outputPrefix]);
  const directory = dirname(outputPrefix);
  const prefix = outputPrefix.slice(directory.length + 1);
  const rendered = readdirSync(directory).filter(
    (name) => name.startsWith(`${prefix}-`) && name.endsWith(".png"),
  );
  if (rendered.length !== expectedPages) fail(`${pdfPath} rendered an unexpected PNG page count`);
}

function convertDocxWithLibreOffice(docxPath, outputDirectory, fontHome) {
  const profile = join(outputDirectory, "lo-profile");
  mkdirSync(profile, { recursive: true });
  run(
    "soffice",
    [
      "--headless",
      `-env:UserInstallation=file://${profile}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outputDirectory,
      docxPath,
    ],
    { env: { ...process.env, HOME: fontHome, TMPDIR: tmpdir() } },
  );
  const pdfPath = join(outputDirectory, `${basename(docxPath, ".docx")}.pdf`);
  if (!existsSync(pdfPath)) fail(`${docxPath} did not convert through LibreOffice`);
  return pdfPath;
}

let missing = 0;
for (const template of manifest.templates) {
  for (const name of requiredNames) {
    if (!existsSync(join(artifactsRoot, template.id, name))) missing += 1;
  }
}

const extraDirectories = existsSync(artifactsRoot)
  ? readdirSync(artifactsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !expectedIds.has(entry.name))
      .map((entry) => entry.name)
  : [];

if (extraDirectories.length > 0) {
  console.error(`Unexpected gold template directories: ${extraDirectories.join(", ")}`);
  process.exitCode = 1;
} else if (missing > 0) {
  console.error(`Missing ${missing} required default gold artifacts`);
  process.exitCode = 1;
} else {
  const verificationRoot = mkdtempSync(join(tmpdir(), "opentrad-gold-verify-"));
  let vite;
  try {
    const fontHome = join(verificationRoot, "font-home");
    const fontDirectories = [join(fontHome, "Library/Fonts"), join(fontHome, ".local/share/fonts")];
    for (const fontDirectory of fontDirectories) {
      mkdirSync(fontDirectory, { recursive: true });
      for (const fontName of ["SourceHanSansCN-Regular.otf", "SourceHanSansCN-Bold.otf"]) {
        copyFileSync(
          join(webRoot, "public/fonts/source-han-sans-cn", fontName),
          join(fontDirectory, fontName),
        );
      }
    }
    run("fc-cache", ["-f"], { env: { ...process.env, HOME: fontHome } });

    const { createServer } = await import(
      new URL("../apps/web/node_modules/vite/dist/node/index.js", import.meta.url)
    );
    vite = await createServer({
      appType: "custom",
      logLevel: "error",
      root: webRoot,
      server: { middlewareMode: true },
    });
    const { templates: launchTemplates } = await vite.ssrLoadModule("/src/data/templates.ts");
    assertManifestMatrix(manifest.templates, launchTemplates);
    const { normalizeDocumentModel, semanticTextDigest } = await vite.ssrLoadModule(
      "/src/features/documents/render/normalizeModel.ts",
    );
    const { buildDocxPlanV2, renderDocxV2 } = await vite.ssrLoadModule(
      "/src/features/documents/render/docx/renderDocxV2.ts",
    );
    const { buildPdfDefinitionV2 } = await vite.ssrLoadModule(
      "/src/features/documents/render/pdf/buildPdfDefinitionV2.ts",
    );
    const loadedPdfMake = requireFromWeb("pdfmake/build/pdfmake");
    const pdfMake = loadedPdfMake.default ?? loadedPdfMake;
    pdfMake.addVirtualFileSystem({
      "SourceHanSansCN-Bold.otf": readFileSync(
        join(webRoot, "public/fonts/source-han-sans-cn/SourceHanSansCN-Bold.otf"),
      ).toString("base64"),
      "SourceHanSansCN-Regular.otf": readFileSync(
        join(webRoot, "public/fonts/source-han-sans-cn/SourceHanSansCN-Regular.otf"),
      ).toString("base64"),
    });
    pdfMake.addFonts({
      SourceHanSansCN: {
        bold: "SourceHanSansCN-Bold.otf",
        bolditalics: "SourceHanSansCN-Bold.otf",
        italics: "SourceHanSansCN-Regular.otf",
        normal: "SourceHanSansCN-Regular.otf",
      },
    });
    for (const template of manifest.templates) {
      const directory = join(artifactsRoot, template.id);
      const model = JSON.parse(readFileSync(join(directory, "default.model.json"), "utf8"));
      const normalizedModel = normalizeDocumentModel(model);
      const digest = semanticTextDigest(normalizedModel, template.language);
      if (!digest || !/\p{Script=Han}/u.test(digest))
        fail(`${template.id} model has no Chinese semantic text`);
      let structuralPlan;
      let declaredOrientations;
      for (const layout of layoutProfiles) {
        const docxPlan = buildDocxPlanV2(normalizedModel, layout, template.language);
        const pdfDefinition = buildPdfDefinitionV2(normalizedModel, layout, template.language);
        if (docxPlan.profile.id !== layout) fail(`${template.id} did not select ${layout}`);
        if (pdfDefinition.defaultStyle?.font !== "SourceHanSansCN") {
          fail(`${template.id} ${layout} PDF plan lost the embedded font family`);
        }
        const expectedOrientations = docxPlan.sections.map((section) => section.orientation);
        declaredOrientations ??= expectedOrientations;
        assertExactOrientations(
          expectedOrientations,
          declaredOrientations,
          `${template.id} ${layout} DOCX plan`,
        );
        const pdfContent = Array.isArray(pdfDefinition.content) ? pdfDefinition.content : [];
        const pdfPlanOrientations = pdfContent.map(
          (section) => section.pageOrientation ?? pdfDefinition.pageOrientation ?? "portrait",
        );
        assertExactOrientations(
          pdfPlanOrientations,
          declaredOrientations,
          `${template.id} ${layout} PDF plan`,
        );
        const docxSemanticModel = {
          ...normalizedModel,
          title: { enUS: docxPlan.title, zhCN: docxPlan.title },
          sections: docxPlan.sections.map((section) => ({
            id: section.id,
            page: { orientation: section.orientation },
            blocks: section.blocks.map((block) => {
              if (block.type === "table") {
                const {
                  cantSplitRows: _cantSplitRows,
                  columnWidthsTwips: _widths,
                  ...semantic
                } = block;
                return semantic;
              }
              if (block.type === "complianceMatrix") {
                const {
                  cantSplitRows: _cantSplitRows,
                  columnWidthsTwips: _widths,
                  repeatHeader: _repeatHeader,
                  ...semantic
                } = block;
                return semantic;
              }
              return block;
            }),
          })),
          disclaimers: docxPlan.disclaimers,
          attachmentManifest: docxPlan.attachmentManifest,
        };
        assertSemanticDigest(
          digest,
          semanticTextDigest(docxSemanticModel, template.language),
          `${template.id} ${layout}`,
          "DOCX plan",
        );
        assertSemanticDigest(
          digest,
          collectStaticText(pdfDefinition.content),
          `${template.id} ${layout}`,
          "PDF plan",
        );
        const nextStructuralPlan = JSON.stringify({
          blockKinds: docxPlan.blockKinds,
          disclaimers: docxPlan.disclaimers,
          sections: docxPlan.sections.map((section) => ({
            blocks: section.blocks.map((block) => block.type),
            id: section.id,
            orientation: section.orientation,
          })),
          watermarks: docxPlan.watermarks,
        });
        structuralPlan ??= nextStructuralPlan;
        if (nextStructuralPlan !== structuralPlan) {
          fail(`${template.id} semantic structure changed under ${layout}`);
        }
      }
      if (!declaredOrientations) fail(`${template.id} has no declared document sections`);

      const docxPath = join(directory, "default.docx");
      const docx = assertDocxSecurity(docxPath, template.id);
      assertExactOrientations(docx.orientations, declaredOrientations, `${template.id} DOCX`);
      assertSemanticDigest(digest, docx.xmlText, template.id, "DOCX");

      const pdfPath = join(directory, "default.pdf");
      const pdfInfo = run("pdfinfo", ["-f", "1", "-l", "999", pdfPath]);
      const pdfGeometry = assertA4Pdf(pdfInfo, template.id, declaredOrientations);
      assertEmbeddedFonts(run("pdffonts", [pdfPath]), template.id);
      const pdfText = run("pdftotext", ["-layout", pdfPath, "-"]);
      const pdfRawText = run("pdftotext", ["-raw", pdfPath, "-"]);
      if (!/\p{Script=Han}/u.test(pdfText))
        fail(`${template.id} PDF Chinese text is not extractable`);
      assertSemanticDigest(digest, pdfRawText, template.id, "PDF");
      assertBoundingBoxes(run("pdftotext", ["-bbox-layout", pdfPath, "-"]), template.id);

      const renderDirectory = join(verificationRoot, template.id);
      mkdirSync(renderDirectory, { recursive: true });
      renderPdfPages(pdfPath, join(renderDirectory, "pdf"), pdfGeometry.pageCount);
      const officeDirectory = join(renderDirectory, "libreoffice");
      mkdirSync(officeDirectory, { recursive: true });
      const officePdf = convertDocxWithLibreOffice(docxPath, officeDirectory, fontHome);
      const officeInfo = run("pdfinfo", ["-f", "1", "-l", "999", officePdf]);
      const officeGeometry = assertA4Pdf(
        officeInfo,
        `${template.id} LibreOffice`,
        declaredOrientations,
      );
      const officeText = run("pdftotext", ["-layout", officePdf, "-"]);
      if (!/\p{Script=Han}/u.test(officeText)) {
        fail(`${template.id} LibreOffice conversion has no extractable Chinese text`);
      }
      renderPdfPages(officePdf, join(officeDirectory, "page"), officeGeometry.pageCount);

      if (fullCrossLayoutTemplateIds.has(template.id)) {
        for (const layout of layoutProfiles) {
          const crossDirectory = join(verificationRoot, "cross-layout", template.id, layout);
          mkdirSync(crossDirectory, { recursive: true });
          const crossDocxPath = join(crossDirectory, "full.docx");
          const crossDocx = await renderDocxV2(model, layout, template.language);
          writeFileSync(crossDocxPath, Buffer.from(await crossDocx.arrayBuffer()));
          const crossDocxResult = assertDocxSecurity(crossDocxPath, `${template.id} ${layout}`);
          assertExactOrientations(
            crossDocxResult.orientations,
            declaredOrientations,
            `${template.id} ${layout} DOCX`,
          );
          assertSemanticDigest(digest, crossDocxResult.xmlText, `${template.id} ${layout}`, "DOCX");

          const crossPdfPath = join(crossDirectory, "full.pdf");
          const crossPdfDefinition = buildPdfDefinitionV2(model, layout, template.language);
          writeFileSync(crossPdfPath, await pdfMake.createPdf(crossPdfDefinition).getBuffer());
          const crossPdfInfo = run("pdfinfo", ["-f", "1", "-l", "999", crossPdfPath]);
          const crossPdfGeometry = assertA4Pdf(
            crossPdfInfo,
            `${template.id} ${layout}`,
            declaredOrientations,
          );
          assertEmbeddedFonts(run("pdffonts", [crossPdfPath]), `${template.id} ${layout}`);
          const crossPdfText = run("pdftotext", ["-raw", crossPdfPath, "-"]);
          assertSemanticDigest(digest, crossPdfText, `${template.id} ${layout}`, "PDF");
          assertBoundingBoxes(
            run("pdftotext", ["-bbox-layout", crossPdfPath, "-"]),
            `${template.id} ${layout}`,
          );
          renderPdfPages(crossPdfPath, join(crossDirectory, "pdf"), crossPdfGeometry.pageCount);

          const crossOfficeDirectory = join(crossDirectory, "libreoffice");
          mkdirSync(crossOfficeDirectory, { recursive: true });
          const crossOfficePdf = convertDocxWithLibreOffice(
            crossDocxPath,
            crossOfficeDirectory,
            fontHome,
          );
          const crossOfficeInfo = run("pdfinfo", ["-f", "1", "-l", "999", crossOfficePdf]);
          const crossOfficeGeometry = assertA4Pdf(
            crossOfficeInfo,
            `${template.id} ${layout} LibreOffice`,
            declaredOrientations,
          );
          renderPdfPages(
            crossOfficePdf,
            join(crossOfficeDirectory, "page"),
            crossOfficeGeometry.pageCount,
          );
        }
      }
    }
    console.log("Verified 15 models, 15 DOCX files and 15 PDF files");
  } finally {
    if (vite) await vite.close();
    if (process.env.KEEP_GOLD_RENDER_OUTPUT === "1") {
      console.log(`Rendered verification pages in ${verificationRoot}`);
    } else {
      rmSync(verificationRoot, { force: true, recursive: true });
    }
  }
}
