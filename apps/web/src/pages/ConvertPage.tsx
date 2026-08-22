import { ArrowRight, CheckCircle2, CloudCog, FileArchive, LockKeyhole } from "lucide-react";
import {
  LocalConversionPanel,
  type LocalConversionPanelServices,
} from "../features/conversion/LocalConversionPanel";

const serverCapabilities = ["Office 转 PDF", "OCR 文字识别", "复杂表格处理", "复杂版式重排"];

export function ConvertPage({
  localServices,
}: {
  readonly localServices?: LocalConversionPanelServices;
} = {}) {
  return (
    <div className="workspace-page convert-page">
      <header className="page-heading section-container">
        <span className="eyebrow">安全清晰的处理边界</span>
        <h1>格式转换</h1>
        <p>支持多种格式相互转换，满足不同场景需求</p>
      </header>

      <div className="conversion-grid section-container">
        <LocalConversionPanel services={localServices} />

        <section className="conversion-card server-card">
          <div className="conversion-heading">
            <span className="conversion-icon blue">
              <CloudCog size={26} />
            </span>
            <div>
              <span className="status-pill blue">增强能力</span>
              <h2>服务器增强</h2>
              <p>处理复杂表格、旧版 Office 与复杂版式任务</p>
            </div>
          </div>
          <ul>
            {serverCapabilities.map((capability) => (
              <li key={capability}>
                <CheckCircle2 size={15} /> {capability}
              </li>
            ))}
          </ul>
          <div className="file-drop server-drop">
            <FileArchive size={31} />
            <strong>登录后选择增强转换</strong>
            <span>Office 转 PDF、OCR 与复杂文档处理，任务完成后自动清理</span>
            <button type="button" disabled>
              <LockKeyhole size={15} /> 需登录后使用 <ArrowRight size={15} />
            </button>
          </div>
          <div className="boundary-note blue">
            <LockKeyhole size={17} />
            <span>
              <strong>登录后可用；当前不会上传文件或发起网络请求</strong>
              服务器增强与本地处理保持明确分离。
            </span>
          </div>
        </section>
      </div>

      <section className="conversion-history section-container">
        <div>
          <h2>转换记录</h2>
          <span>仅展示本次浏览器会话的本地记录</span>
        </div>
        <div className="history-empty">
          <FileArchive size={22} />
          <span>暂无转换记录</span>
        </div>
      </section>
    </div>
  );
}
