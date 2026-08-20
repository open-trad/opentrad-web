import {
  type DisclaimerRefV2,
  type DocumentBlockV2,
  type DocumentLanguageV2,
  type DocumentModel,
  type DocumentModelV2,
  type LayoutStyleId,
  type LocalizedText,
  v2,
} from "@opentrad/document-core";
import { Fragment, type ReactNode } from "react";
import {
  attachmentStatusText,
  complianceRequirementText,
  documentCellValue,
  documentDisclaimerText,
  localizedTextParts,
  localizedTextValue,
  normalizeDocumentModel,
} from "../normalizeModel";
import "./DocumentHtml.css";

const UI_TEXT = {
  documentSection: { zhCN: "文档章节", enUS: "Document section" },
  cover: { zhCN: "封面", enUS: "Cover" },
  parties: { zhCN: "交易双方", enUS: "Parties" },
  dataTable: { zhCN: "数据表格", enUS: "Data table" },
  notice: { zhCN: "提示", enUS: "Notice" },
  toc: { zhCN: "目录", enUS: "Table of contents" },
  tocPlaceholder: {
    zhCN: "目录将在导出时自动生成。",
    enUS: "The contents will be generated on export.",
  },
  complianceMatrix: { zhCN: "符合性矩阵", enUS: "Compliance matrix" },
  sourceReference: { zhCN: "来源条款", enUS: "Source reference" },
  requirementType: { zhCN: "要求性质", enUS: "Requirement type" },
  attachmentIndex: { zhCN: "附件目录", enUS: "Attachment index" },
  attachmentPage: { zhCN: "附件页", enUS: "Attachment page" },
  localAttachmentPlaceholder: {
    zhCN: "本地附件占位符",
    enUS: "Local attachment placeholder",
  },
  page: { zhCN: "页", enUS: "Page" },
  signatureArea: { zhCN: "签署区", enUS: "Signature area" },
  pageBreak: { zhCN: "分页符", enUS: "Page break" },
  disclaimer: { zhCN: "使用提示", enUS: "Disclaimer" },
  watermark: { zhCN: "水印", enUS: "Watermark" },
} as const satisfies Record<string, LocalizedText>;

type Attachment = DocumentModelV2["attachmentManifest"][number];

export interface DocumentHtmlProps {
  readonly model: DocumentModel | DocumentModelV2;
  readonly layoutStyleId: LayoutStyleId;
  readonly languageView: DocumentLanguageV2;
  readonly className?: string;
}

interface RenderContext {
  readonly languageView: DocumentLanguageV2;
  readonly attachments: ReadonlyMap<string, Attachment>;
  readonly stripedTables: boolean;
}

function textLabel(value: LocalizedText, languageView: DocumentLanguageV2): string {
  return localizedTextValue(value, languageView);
}

function LocalizedTextContent({
  value,
  languageView,
}: {
  readonly value: LocalizedText;
  readonly languageView: DocumentLanguageV2;
}) {
  const parts = localizedTextParts(value, languageView);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.language}>
          {index === 0 ? null : " / "}
          <span lang={part.language} data-document-language={part.language}>
            {part.text}
          </span>
        </Fragment>
      ))}
    </>
  );
}

function requireAttachment(
  attachments: ReadonlyMap<string, Attachment>,
  attachmentId: string,
): Attachment {
  const attachment = attachments.get(attachmentId);
  if (!attachment) throw new Error("附件引用无效");
  return attachment;
}

function safeColumnWidth(width: string): string | undefined {
  return /^(?:100|(?:[1-9]?\d)(?:\.\d+)?)%$/u.test(width) ? width : undefined;
}

function alignmentClass(align: "left" | "center" | "right"): string {
  return `document-html__align-${align}`;
}

function blockHeading(
  level: 1 | 2 | 3,
  id: string,
  text: LocalizedText,
  languageView: DocumentLanguageV2,
): ReactNode {
  const content = <LocalizedTextContent value={text} languageView={languageView} />;
  if (level === 1) {
    return (
      <h2 data-block-id={id} data-block-type="heading">
        {content}
      </h2>
    );
  }
  if (level === 2) {
    return (
      <h3 data-block-id={id} data-block-type="heading">
        {content}
      </h3>
    );
  }
  return (
    <h4 data-block-id={id} data-block-type="heading">
      {content}
    </h4>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported V2 document block: ${String(value)}`);
}

function renderBlock(block: DocumentBlockV2, context: RenderContext): ReactNode {
  const { attachments, languageView } = context;
  switch (block.type) {
    case "cover":
      return (
        <section
          aria-label={textLabel(UI_TEXT.cover, languageView)}
          className="document-html__cover"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          <h2>
            <LocalizedTextContent value={block.title} languageView={languageView} />
          </h2>
          {block.subtitle ? (
            <p>
              <LocalizedTextContent value={block.subtitle} languageView={languageView} />
            </p>
          ) : null}
        </section>
      );
    case "heading":
      return blockHeading(block.level, block.id, block.text, languageView);
    case "paragraph":
      return (
        <p
          className="document-html__paragraph"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          <LocalizedTextContent value={block.text} languageView={languageView} />
        </p>
      );
    case "keyValueGrid":
      return (
        <dl
          className="document-html__key-value-grid"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          {block.entries.map((entry, entryIndex) => (
            <div key={`${entryIndex}-${entry.id}`} data-entry-id={entry.id}>
              <dt>
                <LocalizedTextContent value={entry.label} languageView={languageView} />
              </dt>
              <dd>
                <LocalizedTextContent value={entry.value} languageView={languageView} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "parties":
      return (
        <section
          aria-label={textLabel(UI_TEXT.parties, languageView)}
          className="document-html__parties"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          {block.parties.map((party, partyIndex) => (
            <section
              className="document-html__party"
              data-party-id={party.id}
              key={`${partyIndex}-${party.id}`}
            >
              <h3>
                <LocalizedTextContent value={party.role} languageView={languageView} />
              </h3>
              <p>
                <strong>
                  <LocalizedTextContent value={party.name} languageView={languageView} />
                </strong>
              </p>
              {party.details.map((detail, detailIndex) => (
                <p key={`${party.id}-detail-${detailIndex}`}>
                  <LocalizedTextContent value={detail} languageView={languageView} />
                </p>
              ))}
            </section>
          ))}
        </section>
      );
    case "table": {
      const tableLabel = `${textLabel(UI_TEXT.dataTable, languageView)}：${block.id}`;
      const tableClasses = [
        "document-html__table",
        context.stripedTables ? "document-html__table--striped" : undefined,
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <table
          aria-label={tableLabel}
          className={tableClasses}
          data-block-id={block.id}
          data-block-type={block.type}
          data-repeat-header={String(block.repeatHeader)}
        >
          <caption>{tableLabel}</caption>
          <colgroup>
            {block.columns.map((column, columnIndex) => (
              <col key={`${columnIndex}-${column.id}`} width={safeColumnWidth(column.width)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {block.columns.map((column, columnIndex) => (
                <th
                  className={alignmentClass(column.align)}
                  key={`${columnIndex}-${column.id}`}
                  scope="col"
                >
                  <LocalizedTextContent value={column.label} languageView={languageView} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.id}`} data-row-id={row.id}>
                {block.columns.map((column, columnIndex) => (
                  <td className={alignmentClass(column.align)} key={`${columnIndex}-${column.id}`}>
                    <LocalizedTextContent
                      value={documentCellValue(row.cells, column.id)}
                      languageView={languageView}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "totals":
      return (
        <dl className="document-html__totals" data-block-id={block.id} data-block-type={block.type}>
          {block.entries.map((entry, entryIndex) => (
            <div key={`${entryIndex}-${entry.id}`} data-entry-id={entry.id}>
              <dt>
                <LocalizedTextContent value={entry.label} languageView={languageView} />
              </dt>
              <dd>
                <LocalizedTextContent value={entry.value} languageView={languageView} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "clauseGroup":
      return (
        <section
          aria-label={textLabel(block.title, languageView)}
          className="document-html__clauses"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          <h2>
            <LocalizedTextContent value={block.title} languageView={languageView} />
          </h2>
          {block.clauses.map((clause, clauseIndex) => (
            <section
              className="document-html__clause"
              data-clause-id={clause.id}
              key={`${clauseIndex}-${clause.id}`}
            >
              <h3>
                <span className="document-html__clause-number">{clause.number} </span>
                <LocalizedTextContent value={clause.title} languageView={languageView} />
              </h3>
              {clause.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={`${clause.id}-paragraph-${paragraphIndex}`}>
                  <LocalizedTextContent value={paragraph} languageView={languageView} />
                </p>
              ))}
            </section>
          ))}
        </section>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className="document-html__list" data-block-id={block.id} data-block-type={block.type}>
          {block.items.map((item, itemIndex) => (
            <li key={`${block.id}-item-${itemIndex}`}>
              <LocalizedTextContent value={item} languageView={languageView} />
            </li>
          ))}
        </List>
      );
    }
    case "notice":
      return (
        <aside
          aria-label={textLabel(UI_TEXT.notice, languageView)}
          className="document-html__notice"
          data-block-id={block.id}
          data-block-type={block.type}
          data-notice-tone={block.tone}
        >
          {block.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={`${block.id}-paragraph-${paragraphIndex}`}>
              <LocalizedTextContent value={paragraph} languageView={languageView} />
            </p>
          ))}
        </aside>
      );
    case "declaration":
      return (
        <section
          aria-label={textLabel(block.title, languageView)}
          className="document-html__declaration"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          <h2>
            <LocalizedTextContent value={block.title} languageView={languageView} />
          </h2>
          {block.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={`${block.id}-paragraph-${paragraphIndex}`}>
              <LocalizedTextContent value={paragraph} languageView={languageView} />
            </p>
          ))}
        </section>
      );
    case "toc":
      return (
        <nav
          aria-label={textLabel(UI_TEXT.toc, languageView)}
          className="document-html__toc"
          data-block-id={block.id}
          data-block-type={block.type}
          data-max-depth={block.maxDepth}
        >
          <h2>
            <LocalizedTextContent value={UI_TEXT.toc} languageView={languageView} />
          </h2>
          <p>
            <LocalizedTextContent value={UI_TEXT.tocPlaceholder} languageView={languageView} />
          </p>
        </nav>
      );
    case "complianceMatrix": {
      const matrixLabel = `${textLabel(UI_TEXT.complianceMatrix, languageView)}：${block.id}`;
      const tableClasses = [
        "document-html__compliance-matrix",
        context.stripedTables ? "document-html__table--striped" : undefined,
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <table
          aria-label={matrixLabel}
          className={tableClasses}
          data-block-id={block.id}
          data-block-type={block.type}
        >
          <caption>{matrixLabel}</caption>
          <colgroup>
            <col className="document-html__matrix-source-column" />
            <col className="document-html__matrix-type-column" />
            {block.columns.map((column, columnIndex) => (
              <col key={`${columnIndex}-${column.id}`} width={safeColumnWidth(column.width)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="document-html__align-left" scope="col">
                <LocalizedTextContent value={UI_TEXT.sourceReference} languageView={languageView} />
              </th>
              <th className="document-html__align-center" scope="col">
                <LocalizedTextContent value={UI_TEXT.requirementType} languageView={languageView} />
              </th>
              {block.columns.map((column, columnIndex) => (
                <th
                  className={alignmentClass(column.align)}
                  key={`${columnIndex}-${column.id}`}
                  scope="col"
                >
                  <LocalizedTextContent value={column.label} languageView={languageView} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.id}`} data-row-id={row.id}>
                <th className="document-html__align-left" scope="row">
                  {row.sourceRef}
                </th>
                <td className="document-html__align-center">
                  {complianceRequirementText(row.substantial, languageView)}
                </td>
                {block.columns.map((column, columnIndex) => (
                  <td className={alignmentClass(column.align)} key={`${columnIndex}-${column.id}`}>
                    <LocalizedTextContent
                      value={documentCellValue(row.cells, column.id)}
                      languageView={languageView}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "attachmentIndex":
      return (
        <section
          aria-label={textLabel(UI_TEXT.attachmentIndex, languageView)}
          className="document-html__attachment-index"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          <h2>
            <LocalizedTextContent value={UI_TEXT.attachmentIndex} languageView={languageView} />
          </h2>
          <ul>
            {block.attachmentIds.map((attachmentId, attachmentIndex) => {
              const attachment = requireAttachment(attachments, attachmentId);
              return (
                <li data-attachment-id={attachment.id} key={`${attachmentIndex}-${attachment.id}`}>
                  <span>{attachment.displayName}</span>{" "}
                  <small>{attachmentStatusText(attachment, languageView)}</small>
                </li>
              );
            })}
          </ul>
        </section>
      );
    case "attachmentPage": {
      const attachment = requireAttachment(attachments, block.attachmentId);
      const pageLabel =
        languageView === "en-US"
          ? `${textLabel(UI_TEXT.attachmentPage, languageView)}: ${attachment.displayName}, ${textLabel(UI_TEXT.page, languageView)} ${block.pageNumber}`
          : languageView === "zh-en"
            ? `${textLabel(UI_TEXT.attachmentPage, languageView)}：${attachment.displayName}，第 ${block.pageNumber} 页 / Page ${block.pageNumber}`
            : `${textLabel(UI_TEXT.attachmentPage, languageView)}：${attachment.displayName}，第 ${block.pageNumber} 页`;
      return (
        <section
          aria-label={pageLabel}
          className="document-html__attachment-page"
          data-attachment-id={attachment.id}
          data-block-id={block.id}
          data-block-type={block.type}
          data-page-number={block.pageNumber}
        >
          <h2>{attachment.displayName}</h2>
          <p>
            <LocalizedTextContent
              value={{ zhCN: `第 ${block.pageNumber} 页`, enUS: `Page ${block.pageNumber}` }}
              languageView={languageView}
            />
          </p>
          <p>
            <LocalizedTextContent
              value={UI_TEXT.localAttachmentPlaceholder}
              languageView={languageView}
            />
          </p>
        </section>
      );
    }
    case "signatureGroup":
      return (
        <section
          aria-label={textLabel(UI_TEXT.signatureArea, languageView)}
          className="document-html__signatures"
          data-block-id={block.id}
          data-block-type={block.type}
        >
          {block.signers.map((signer, signerIndex) => (
            <section
              aria-label={textLabel(signer.role, languageView)}
              className="document-html__signer"
              key={`${block.id}-signer-${signerIndex}`}
            >
              <h3>
                <LocalizedTextContent value={signer.role} languageView={languageView} />
              </h3>
              <dl>
                <div>
                  <dt>{signer.name}</dt>
                  <dd>________________</dd>
                </div>
                <div>
                  <dt>
                    <LocalizedTextContent value={signer.dateLabel} languageView={languageView} />
                  </dt>
                  <dd>________________</dd>
                </div>
                {signer.sealLabel ? (
                  <div>
                    <dt>
                      <LocalizedTextContent value={signer.sealLabel} languageView={languageView} />
                    </dt>
                    <dd>________________</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ))}
        </section>
      );
    case "pageBreak":
      return (
        <hr
          aria-label={textLabel(UI_TEXT.pageBreak, languageView)}
          className="document-html__page-break"
          data-block-id={block.id}
          data-block-type={block.type}
        />
      );
    default:
      return assertNever(block);
  }
}

function disclaimerText(disclaimer: DisclaimerRefV2, languageView: DocumentLanguageV2): string {
  return documentDisclaimerText(disclaimer, languageView);
}

export function DocumentHtml({
  model: input,
  layoutStyleId,
  languageView,
  className,
}: DocumentHtmlProps) {
  const model = normalizeDocumentModel(input);
  const profile = v2.getPresentationProfile(layoutStyleId);
  const attachments = new Map(
    model.attachmentManifest.map((attachment) => [attachment.id, attachment] as const),
  );
  const title = localizedTextValue(model.title, languageView);
  const profileClass = `document-html--${profile.id.replaceAll(".", "-")}`;
  const classes = ["document-html", profileClass, className].filter(Boolean).join(" ");
  const context: RenderContext = {
    languageView,
    attachments,
    stripedTables: profile.table.striped,
  };

  return (
    <article
      aria-label={title}
      className={classes}
      data-document-id={model.documentId}
      data-document-kind={model.documentKind}
      data-language-view={languageView}
      data-layout-style={profile.id}
      data-profile-label={profile.label}
      data-profile-striped-tables={String(profile.table.striped)}
      data-schema-version={model.schemaVersion}
      data-template-id={model.template.id}
      data-template-version={model.template.version}
    >
      <header className="document-html__header">
        <h1>
          <LocalizedTextContent value={model.title} languageView={languageView} />
        </h1>
      </header>

      {model.watermarks.map((watermark, watermarkIndex) => (
        <aside
          aria-label={textLabel(UI_TEXT.watermark, languageView)}
          className="document-html__watermark"
          data-watermark-id={watermark.id}
          data-watermark-scope={watermark.scope}
          key={`${watermarkIndex}-${watermark.id}`}
        >
          <LocalizedTextContent value={watermark.text} languageView={languageView} />
        </aside>
      ))}

      {model.sections.map((section, sectionIndex) => (
        <section
          aria-label={`${textLabel(UI_TEXT.documentSection, languageView)}：${section.id}`}
          className="document-html__section"
          data-orientation={section.page?.orientation ?? model.pageDefaults.orientation}
          data-section-id={section.id}
          key={`${sectionIndex}-${section.id}`}
        >
          {section.blocks.map((block, blockIndex) => (
            <Fragment key={`${sectionIndex}-${blockIndex}-${block.id}`}>
              {renderBlock(block, context)}
            </Fragment>
          ))}
        </section>
      ))}

      {model.disclaimers.length > 0 ? (
        <footer className="document-html__disclaimers">
          <h2>
            <LocalizedTextContent value={UI_TEXT.disclaimer} languageView={languageView} />
          </h2>
          <ul>
            {model.disclaimers.map((disclaimer, disclaimerIndex) => (
              <li data-disclaimer={disclaimer} key={`${disclaimerIndex}-${disclaimer}`}>
                {disclaimerText(disclaimer, languageView)}
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </article>
  );
}
