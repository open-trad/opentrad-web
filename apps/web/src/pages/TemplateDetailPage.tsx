import { ArrowLeft, CalendarClock, FileText } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { templates } from "../data/templates";

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
          <span className="eyebrow">模板说明</span>
          <h1>模板不存在</h1>
          <p>未找到对应的模板说明，请返回模板中心选择现有模板。</p>
          <Link to="/templates">
            <ArrowLeft size={16} /> 返回模板中心
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="info-page paper-grain">
      <article className="info-card template-detail-card">
        <span className={`category-tag ${template.accent}`}>{template.category}</span>
        <h1>{template.title}</h1>
        <p>{template.description}</p>
        <div className="template-detail-meta">
          <span>{template.format}</span>
          <span>{template.pages} 页</span>
        </div>
        {template.editorPath ? (
          <Link className="template-detail-primary" to={template.editorPath}>
            打开报价单编辑器
          </Link>
        ) : (
          <div className="availability-note">
            <CalendarClock size={18} />
            <span>
              <strong>第二阶段开放编辑</strong>
              当前页面提供真实模板说明，不会进入尚未实现的编辑器。
            </span>
          </div>
        )}
        <Link to={`/templates?category=${encodeURIComponent(template.category)}`}>
          <ArrowLeft size={16} /> 返回{template.category}模板
        </Link>
      </article>
    </div>
  );
}
