import { FileArchive } from "lucide-react";
import type { AccountPanelClient } from "../features/auth/AccountPanel";
import {
  LocalConversionPanel,
  type LocalConversionPanelServices,
} from "../features/conversion/LocalConversionPanel";
import {
  ServerConversionPanel,
  type ServerConversionServices,
} from "../features/conversion/ServerConversionPanel";

export function ConvertPage({
  localServices,
  serverAccount,
  serverEnabled,
  serverServices,
}: {
  readonly localServices?: LocalConversionPanelServices;
  readonly serverAccount?: AccountPanelClient;
  readonly serverEnabled?: boolean;
  readonly serverServices?: ServerConversionServices;
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

        <ServerConversionPanel
          enabled={serverEnabled}
          account={serverAccount}
          services={serverServices}
        />
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
