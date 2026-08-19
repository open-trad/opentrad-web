import { FileText, Grid2X2, LayoutList, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type TemplateCategory, templates } from "../data/templates";

const categories: Array<{ label: "全部模板" | TemplateCategory; count: number }> = [
  { label: "全部模板", count: templates.length },
  { label: "报价单", count: templates.filter((item) => item.category === "报价单").length },
  { label: "合同", count: templates.filter((item) => item.category === "合同").length },
  { label: "标书", count: templates.filter((item) => item.category === "标书").length },
  { label: "发票", count: templates.filter((item) => item.category === "发票").length },
  { label: "装箱单", count: templates.filter((item) => item.category === "装箱单").length },
];

export function TemplatesPage() {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get("category");
  const [category, setCategory] = useState(
    categories.some((item) => item.label === initialCategory)
      ? (initialCategory ?? "全部模板")
      : "全部模板",
  );
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("全部版式");

  const visibleTemplates = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return templates.filter((template) => {
      const categoryMatch = category === "全部模板" || template.category === category;
      const formatMatch = format === "全部版式" || template.format === format;
      const searchMatch =
        !keyword ||
        `${template.title}${template.description}${template.category}`
          .toLocaleLowerCase("zh-CN")
          .includes(keyword);
      return categoryMatch && formatMatch && searchMatch;
    });
  }, [category, format, query]);

  return (
    <div className="workspace-page templates-page">
      <header className="page-heading section-container">
        <span className="eyebrow">单证模板库</span>
        <h1>模板中心</h1>
        <p>专业的商贸单证模板，支持预览与一键使用</p>
      </header>

      <div className="template-layout section-container">
        <aside className="category-panel" aria-label="模板分类">
          <strong>全部分类</strong>
          <div className="category-list">
            {categories.map((item) => (
              <button
                type="button"
                className={category === item.label ? "active" : ""}
                key={item.label}
                onClick={() => setCategory(item.label)}
              >
                <span>
                  <FileText size={16} /> {item.label}
                </span>
                <small>{item.count}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="template-results" aria-label="模板结果">
          <div className="template-toolbar">
            <label className="select-field">
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span className="sr-only">模板版式</span>
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option>全部版式</option>
                <option>A4</option>
                <option>Letter</option>
              </select>
            </label>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">搜索模板</span>
              <input
                type="search"
                aria-label="搜索模板"
                placeholder="搜索模板名称或关键词"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span className="result-count">{visibleTemplates.length} 个模板</span>
            <div className="view-toggle" aria-hidden="true">
              <Grid2X2 size={16} />
              <LayoutList size={16} />
            </div>
          </div>

          {visibleTemplates.length > 0 ? (
            <div className="template-grid">
              {visibleTemplates.map((template) => (
                <article className="template-card" key={template.id}>
                  <div className={`document-preview ${template.accent}`} aria-hidden="true">
                    <div className="document-title" />
                    <div className="document-line short" />
                    <div className="document-line" />
                    <div className="document-table">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="document-line" />
                  </div>
                  <div className="template-card-body">
                    <span className={`category-tag ${template.accent}`}>{template.category}</span>
                    <h2>{template.title}</h2>
                    <p>{template.description}</p>
                    <div className="template-meta">
                      <span>{template.format}</span>
                      <span>{template.pages} 页</span>
                    </div>
                    <Link to={template.to} aria-label={`使用模板：${template.title}`}>
                      使用模板
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={30} />
              <strong>没有匹配的模板</strong>
              <p>调整分类、版式或搜索关键词后重试。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
