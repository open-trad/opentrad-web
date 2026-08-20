import { FileText, Grid2X2, Languages, LayoutList, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type TemplateCategoryLabel, templates } from "../data/templates";

const CATEGORY_LABELS = [
  "报价单",
  "合同",
  "标书",
] as const satisfies readonly TemplateCategoryLabel[];

const categories: ReadonlyArray<{
  label: "全部模板" | TemplateCategoryLabel;
  count: number;
}> = [
  { label: "全部模板", count: templates.length },
  ...CATEGORY_LABELS.map((label) => ({
    label,
    count: templates.filter((template) => template.category === label).length,
  })),
];

type LanguageFilter = "全部语言" | "中文" | "中英双语";

function matchesLanguage(languages: readonly string[], filter: LanguageFilter) {
  if (filter === "全部语言") {
    return true;
  }
  if (filter === "中英双语") {
    return (
      languages.includes("zh-en") || (languages.includes("zh-CN") && languages.includes("en-US"))
    );
  }
  return languages.includes("zh-CN") && !languages.includes("zh-en");
}

export function TemplatesPage() {
  const resultsId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get("category");
  const category = categories.some((item) => item.label === requestedCategory)
    ? (requestedCategory as "全部模板" | TemplateCategoryLabel)
    : "全部模板";
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<LanguageFilter>("全部语言");

  const selectCategory = (nextCategory: "全部模板" | TemplateCategoryLabel) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextCategory === "全部模板") {
      nextSearchParams.delete("category");
    } else {
      nextSearchParams.set("category", nextCategory);
    }
    setSearchParams(nextSearchParams);
  };

  const visibleTemplates = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return templates.filter((template) => {
      const categoryMatch = category === "全部模板" || template.category === category;
      const languageMatch = matchesLanguage(template.languages, language);
      const searchMatch =
        !keyword ||
        `${template.title}${template.description}${template.category}`
          .toLocaleLowerCase("zh-CN")
          .includes(keyword);
      return categoryMatch && languageMatch && searchMatch;
    });
  }, [category, language, query]);

  return (
    <div className="workspace-page templates-page">
      <header className="page-heading section-container">
        <span className="eyebrow">单证模板库</span>
        <h1>模板中心</h1>
        <p>15 份本地模板，覆盖报价、合同与标书，可按分类和语言快速筛选</p>
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
                aria-controls={resultsId}
                aria-pressed={category === item.label}
                onClick={() => selectCategory(item.label)}
              >
                <span>
                  <FileText size={16} aria-hidden="true" /> {item.label}
                </span>
                <small>{item.count}</small>
              </button>
            ))}
          </div>
        </aside>

        <section id={resultsId} className="template-results" aria-label="模板结果">
          <div className="template-toolbar">
            <label className="select-field">
              <Languages size={15} aria-hidden="true" />
              <span className="sr-only">模板语言</span>
              <select
                aria-label="模板语言"
                value={language}
                onChange={(event) => setLanguage(event.target.value as LanguageFilter)}
              >
                <option>全部语言</option>
                <option>中文</option>
                <option>中英双语</option>
              </select>
            </label>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">搜索模板</span>
              <input
                type="search"
                aria-label="搜索模板"
                placeholder="搜索模板名称、说明或分类"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <span className="result-count" aria-live="polite" aria-atomic="true">
              {visibleTemplates.length} 个模板
            </span>
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
                      <span>版本 {template.version}</span>
                    </div>
                    <Link to={template.editorPath} aria-label={`使用模板：${template.title}`}>
                      使用模板
                    </Link>
                    <Link
                      to={`/templates/${template.id}`}
                      aria-label={`查看详情：${template.title}`}
                    >
                      查看详情
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <output className="empty-state" aria-live="polite">
              <FileText size={30} aria-hidden="true" />
              <strong>没有匹配的模板</strong>
              <p>调整分类、语言或搜索关键词后重试。</p>
            </output>
          )}
        </section>
      </div>
    </div>
  );
}
