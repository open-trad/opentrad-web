import {
  BadgeCheck,
  FileCheck2,
  FilePenLine,
  FileSignature,
  FileStack,
  FolderSync,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
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
    description: "标准合同模板与智能填写",
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

const promises = [
  { label: "开源免费", text: "透明开放，自由使用", icon: <BadgeCheck /> },
  { label: "本地优先", text: "核心任务在设备完成", icon: <HardDrive /> },
  { label: "数据安全", text: "边界清楚，您掌控数据", icon: <ShieldCheck /> },
  { label: "持续更新", text: "社区协作，不断完善", icon: <RefreshCw /> },
];

export function HomePage() {
  return (
    <div className="home-page paper-grain">
      <section className="hero section-container">
        <div className="hero-kicker">
          <FileStack size={16} />
          <span>全球贸易文档工作台</span>
        </div>
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

      <section className="trust-strip" aria-label="OpenTrad 可信承诺">
        <div className="trust-grid section-container">
          {promises.map((promise) => (
            <div className="trust-item" key={promise.label}>
              <span aria-hidden="true">{promise.icon}</span>
              <div>
                <strong>{promise.label}</strong>
                <small>{promise.text}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
