import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { ConvertPage } from "./pages/ConvertPage";
import { HomePage } from "./pages/HomePage";
import { InfoPage } from "./pages/InfoPage";
import { QuoteEditorPage } from "./pages/QuoteEditorPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <div className="app-shell">
        <AppHeader />
        <main>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/editor/standard-goods-quote" element={<QuoteEditorPage />} />
            <Route path="/convert" element={<ConvertPage />} />
            <Route
              path="/help"
              element={
                <InfoPage
                  eyebrow="使用指南"
                  title="帮助文档"
                  description="从模板选择、单证填写到格式转换，按清晰步骤完成每一份贸易文档。"
                />
              }
            />
            <Route
              path="/about"
              element={
                <InfoPage
                  eyebrow="关于项目"
                  title="开放、可信的商贸工具"
                  description="OpenTrad 以本地优先和开放协作为原则，为全球贸易团队提供可靠的单证工作台。"
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
