import { ArrowLeft, BookOpenText } from "lucide-react";
import { Link } from "react-router-dom";

type InfoPageProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function InfoPage({ eyebrow, title, description }: InfoPageProps) {
  return (
    <div className="info-page paper-grain">
      <section className="info-card">
        <span className="info-icon">
          <BookOpenText size={27} />
        </span>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <Link to="/">
          <ArrowLeft size={16} /> 返回工具首页
        </Link>
      </section>
    </div>
  );
}
