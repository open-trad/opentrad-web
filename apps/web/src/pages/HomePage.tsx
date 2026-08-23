import { FileCheck2, FilePenLine, FileSignature, FolderSync } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type ToolCard = {
  title: string;
  description: string;
  to: string;
  icon: ReactNode;
  tone: "green" | "blue" | "forest" | "copper";
  detail: string;
};

const tools: ToolCard[] = [
  {
    title: "格式转换",
    description: "支持多种格式相互转换",
    to: "/convert",
    icon: <FolderSync size={32} />,
    tone: "green",
    detail: "PDF · Word · Excel · 图片",
  },
  {
    title: "报价单",
    description: "快速创建专业报价单",
    to: "/editor/standard-goods-quote",
    icon: <FilePenLine size={32} />,
    tone: "blue",
    detail: "商品明细 · 币种 · 条款",
  },
  {
    title: "合同",
    description: "标准合同模板与结构化填写",
    to: "/templates?category=合同",
    icon: <FileSignature size={32} />,
    tone: "forest",
    detail: "采购 · 销售 · 服务",
  },
  {
    title: "标书",
    description: "投标准备与生成工具包",
    to: "/templates?category=标书",
    icon: <FileCheck2 size={32} />,
    tone: "copper",
    detail: "商务标 · 技术标 · 附件",
  },
];

export function HomePage() {
  return (
    <div className="home-page paper-grain">
      <section className="hero section-container">
        <h1>专业的开源商贸单证工具包</h1>
        <p>从创建、编辑到转换，满足您的全球贸易文档需求</p>
      </section>

      <section className="tool-grid section-container" aria-label="核心工具">
        {tools.map((tool) => (
          <Link className="tool-card" to={tool.to} key={tool.title}>
            <span className={`tool-icon ${tool.tone}`} aria-hidden="true">
              {tool.icon}
            </span>
            <span className="tool-copy">
              <strong>{tool.title}</strong>
              <small>{tool.description}</small>
            </span>
            <span className="mini-document" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="tool-detail">{tool.detail}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
