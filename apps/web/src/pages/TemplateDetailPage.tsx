import { OFFICIAL_SOURCES } from "@opentrad/document-core";
import { ArrowLeft, BookOpenText, FileText, ShieldAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { templates } from "../data/templates";

const DISCLAIMER_COPY = {
  quotation: "本工具生成报价结构，不构成法律、税务或会计意见。",
  contract: "本工具生成合同草案，不构成法律意见；签署前应由当事人自行审阅。",
  international: "本工具不判断 Incoterms、CISG、适用法、税则或语言优先的正确选择。",
  bid: "本工具不保证投标合规或中标；最终内容必须逐项对应招标文件及全部澄清版本。",
} as const;

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  "zh-CN": "中文",
  "en-US": "英文",
  "zh-en": "中英双语",
};

const METADATA_ITEM_STYLE = {
  maxWidth: "100%",
  overflowWrap: "anywhere",
} as const;

export function TemplateDetailPage() {
  const { templateId } = useParams();
  const template = templates.find((item) => item.id === templateId);

  if (!template) {
    return (
      <div className="info-page paper-grain">
        <section className="info-card">
          <span className="info-icon" aria-hidden="true">
            <FileText size={27} />
          </span>
          <span className="eyebrow">模板错误</span>
          <h1>模板不存在</h1>
          <p>未找到编号为 {templateId ?? "未知"} 的模板，请返回模板中心选择现有模板。</p>
          <Link to="/templates">
            <ArrowLeft size={16} /> 返回模板中心
          </Link>
        </section>
      </div>
    );
  }

  const languageCopy = template.languages
    .map((language) => LANGUAGE_LABELS[language] ?? language)
    .join("、");

  return (
    <div className="info-page paper-grain">
      <article className="info-card template-detail-card">
        <span className={`category-tag ${template.accent}`}>{template.category}</span>
        <h1>{template.title}</h1>
        <p>{template.description}</p>

        <div className="template-detail-meta" style={{ flexWrap: "wrap" }}>
          <span style={METADATA_ITEM_STYLE}>版本 {template.version}</span>
          <span style={METADATA_ITEM_STYLE}>依据审阅日期 {template.basisDate}</span>
          <span style={METADATA_ITEM_STYLE}>默认版式 {template.defaultLayout}</span>
          <span style={METADATA_ITEM_STYLE}>语言 {languageCopy}</span>
        </div>

        <section className="availability-note" aria-label="模板参考来源">
          <BookOpenText size={18} aria-hidden="true" />
          <span>
            <strong>参考来源</strong>
            <ul aria-label="参考来源">
              {template.sourceKeys.map((sourceKey) => {
                const source = OFFICIAL_SOURCES[sourceKey];
                return (
                  <li key={sourceKey} data-source-key={sourceKey}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                    <small>{source.authority}</small>
                  </li>
                );
              })}
            </ul>
            <small>
              依据审阅日期表示本项目核对引用来源的时间。参考来源不代表来源机构认可本模板，也不构成持续更新或合规保证。
            </small>
          </span>
        </section>

        <section className="availability-note" aria-label="模板风险提示">
          <ShieldAlert size={18} aria-hidden="true" />
          <span>
            <h2>风险提示</h2>
            <small>{DISCLAIMER_COPY[template.disclaimerProfile]}</small>
          </span>
        </section>

        <Link className="template-detail-primary" to={template.editorPath}>
          使用此模板
        </Link>
        <Link to={`/templates?category=${encodeURIComponent(template.category)}`}>
          <ArrowLeft size={16} /> 返回{template.category}模板
        </Link>
      </article>
    </div>
  );
}
