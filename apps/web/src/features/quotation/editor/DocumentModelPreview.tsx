import type { DocumentModel, DocumentNode } from "@opentrad/document-core";
import type { ReactNode } from "react";

function assertNever(value: never): never {
  throw new Error(`Unsupported document node: ${String(value)}`);
}

function renderNode(node: DocumentNode): ReactNode {
  switch (node.type) {
    case "heading": {
      const Heading = node.level === 1 ? "h2" : "h3";
      return (
        <header className="document-heading" key={node.id}>
          <div className="document-brand">OpenTrad</div>
          <Heading>{node.text}</Heading>
          {node.level === 1 && <span>QUOTATION</span>}
        </header>
      );
    }
    case "metadata":
      return (
        <dl className="document-metadata" key={node.id}>
          {node.entries.map((entry) => (
            <div key={entry.id}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "parties":
      return (
        <section className="document-parties" key={node.id} aria-label="交易双方">
          {node.parties.map((party) => (
            <div key={party.role}>
              <small>{party.label}</small>
              <strong>{party.name}</strong>
              {party.details.map((detail, detailIndex) => (
                <p key={`${node.id}-${party.role}-detail-${detailIndex}`}>{detail}</p>
              ))}
            </div>
          ))}
        </section>
      );
    case "table":
      return (
        <div className="document-table-scroll" key={node.id}>
          <table>
            <thead>
              <tr>
                {node.columns.map((column) => (
                  <th key={column.id} style={{ width: column.width, textAlign: column.align }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row) => (
                <tr key={row.id}>
                  {node.columns.map((column) => (
                    <td key={column.id} style={{ textAlign: column.align }}>
                      {row.cells[column.id] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "totals":
      return (
        <dl className="document-totals" key={node.id}>
          {node.entries.map((entry) => (
            <div key={entry.id}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "terms":
      return (
        <section className="document-terms" key={node.id} aria-label="条款与备注">
          <h3>条款与备注</h3>
          {node.entries.map((entry) => (
            <p key={entry.id}>
              <strong>{entry.label}：</strong>
              {entry.value}
            </p>
          ))}
        </section>
      );
    case "notice":
      return (
        <aside className="document-notice" key={node.id} aria-label="报价提示">
          {node.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={`${node.id}-paragraph-${paragraphIndex}`}>{paragraph}</p>
          ))}
        </aside>
      );
    case "signature":
      return (
        <section className="document-signature" key={node.id} aria-label="签署区">
          <span>{node.signerLabel}</span>
          <span>{node.dateLabel}</span>
        </section>
      );
    default:
      return assertNever(node);
  }
}

export function DocumentModelPreview({ model }: { model: DocumentModel }) {
  return (
    <article className="a4-sheet document-model-preview" aria-label="标准货物报价单文档">
      {model.nodes.map(renderNode)}
      <footer>OpenTrad 开源商贸 · 本地生成</footer>
    </article>
  );
}
