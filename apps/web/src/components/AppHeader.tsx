import { Languages, Menu, X } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";

const links = [
  { label: "首页", to: "/" },
  { label: "模板中心", to: "/templates" },
  { label: "格式转换", to: "/convert" },
];

export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <NavLink className="brand" to="/">
          <img
            className="brand-avatar"
            src={`${import.meta.env.BASE_URL}brand/open-trad.png`}
            alt=""
          />
          <span>OpenTrad</span>
          <em>开源商贸</em>
        </NavLink>

        <button
          className="menu-button"
          type="button"
          aria-label={menuOpen ? "关闭导航" : "打开导航"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <nav className={menuOpen ? "main-nav is-open" : "main-nav"} aria-label="主导航">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <button
          className="language-button"
          type="button"
          aria-label="简体中文，第二阶段开放"
          title="语言切换将在第二阶段开放"
          disabled
        >
          <Languages size={16} />
          <span>简体中文</span>
        </button>
      </div>
    </header>
  );
}
