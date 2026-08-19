import {
  ArrowRight,
  CheckCircle2,
  CloudCog,
  FileArchive,
  FileUp,
  HardDrive,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

const localCapabilities = ["文件不上网", "处理速度快", "支持离线使用", "保护商业隐私"];
const serverCapabilities = ["支持超大文件", "更高的格式保真度", "复杂版式重排", "隔离的临时处理"];

export function ConvertPage() {
  const [localFile, setLocalFile] = useState<File | null>(null);

  return (
    <div className="workspace-page convert-page">
      <header className="page-heading section-container">
        <span className="eyebrow">安全清晰的处理边界</span>
        <h1>格式转换</h1>
        <p>支持多种格式相互转换，满足不同场景需求</p>
      </header>

      <div className="conversion-grid section-container">
        <section className="conversion-card local-card">
          <div className="conversion-heading">
            <span className="conversion-icon green">
              <HardDrive size={26} />
            </span>
            <div>
              <span className="status-pill">推荐</span>
              <h2>本地处理</h2>
              <p>文件在您的设备上处理，保护隐私，离线可用</p>
            </div>
          </div>
          <ul>
            {localCapabilities.map((capability) => (
              <li key={capability}>
                <CheckCircle2 size={15} /> {capability}
              </li>
            ))}
          </ul>
          <label className="file-drop local-drop">
            <input
              type="file"
              aria-label="选择本地转换文件"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              onChange={(event) => setLocalFile(event.target.files?.[0] ?? null)}
            />
            <FileUp size={31} />
            <strong>{localFile ? localFile.name : "点击或拖拽文件到此处"}</strong>
            <span>支持 PDF、Word、Excel、图片，单个文件不超过 20 MB</span>
            <em>{localFile ? "文件已在本机就绪" : "选择文件"}</em>
          </label>
          <div className="boundary-note">
            <ShieldCheck size={17} />
            <span>
              <strong>文件不会离开您的设备</strong>
              浏览器内读取，本页面不会自动上传。
            </span>
          </div>
        </section>

        <section className="conversion-card server-card">
          <div className="conversion-heading">
            <span className="conversion-icon blue">
              <CloudCog size={26} />
            </span>
            <div>
              <span className="status-pill blue">增强能力</span>
              <h2>服务器增强</h2>
              <p>利用服务器能力处理大文件或复杂任务</p>
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
            <span>支持更大文件与高级版式，任务完成后自动清理</span>
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
