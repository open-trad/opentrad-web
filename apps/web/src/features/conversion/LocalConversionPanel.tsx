import { CheckCircle2, FileUp, HardDrive, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  defaultLocalConversionRuntime,
  LOCAL_BROWSER_CAPABILITIES,
  LOCAL_FILE_ACCEPT,
  type LocalBrowserOperation,
  type LocalConversionResult,
  runLocalConversion,
} from "./localConversionClient";

export interface LocalConversionPanelServices {
  readonly download: (bytes: Uint8Array<ArrayBuffer>, mediaType: string, name: string) => void;
  readonly run: (
    selection: {
      readonly files: readonly File[];
      readonly operation: LocalBrowserOperation;
      readonly outputFormat: LocalConversionResult["outputFormat"];
    },
    signal: AbortSignal,
  ) => Promise<LocalConversionResult>;
}

function downloadBytes(bytes: Uint8Array<ArrayBuffer>, mediaType: string, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const defaultServices: LocalConversionPanelServices = Object.freeze({
  download: downloadBytes,
  run: (selection: Parameters<LocalConversionPanelServices["run"]>[0], signal: AbortSignal) =>
    runLocalConversion(
      selection as Parameters<typeof runLocalConversion>[0],
      defaultLocalConversionRuntime(),
      signal,
    ),
});

function formatLabel(value: string): string {
  return value.toUpperCase();
}

export function LocalConversionPanel({
  services = defaultServices,
}: {
  readonly services?: LocalConversionPanelServices;
}) {
  const firstCapability = LOCAL_BROWSER_CAPABILITIES[0];
  if (!firstCapability) throw new Error("LOCAL_CAPABILITIES_UNAVAILABLE");
  const [operation, setOperation] = useState<LocalBrowserOperation>(
    firstCapability.id as LocalBrowserOperation,
  );
  const [outputFormat, setOutputFormat] = useState(
    firstCapability.outputFormats[1] ?? firstCapability.outputFormats[0] ?? "txt",
  );
  const [files, setFiles] = useState<readonly File[]>([]);
  const [status, setStatus] = useState("选择文件后可在浏览器内转换");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const titleId = useId();
  const activeController = useRef<AbortController | null>(null);
  const runSequence = useRef(0);
  const capability = useMemo(
    () => LOCAL_BROWSER_CAPABILITIES.find((item) => item.id === operation) ?? firstCapability,
    [firstCapability, operation],
  );

  useEffect(
    () => () => {
      runSequence.current += 1;
      activeController.current?.abort();
    },
    [],
  );

  const changeOperation = (next: string) => {
    const found = LOCAL_BROWSER_CAPABILITIES.find((item) => item.id === next);
    if (!found) return;
    activeController.current?.abort();
    runSequence.current += 1;
    setOperation(found.id as LocalBrowserOperation);
    setOutputFormat(found.outputFormats[0] ?? "txt");
    setFiles([]);
    setError(null);
    setRunning(false);
    setStatus("选择文件后可在浏览器内转换");
  };

  const changeOutput = (next: string) => {
    for (let index = 0; index < capability.outputFormats.length; index += 1) {
      if (capability.outputFormats[index] === next) {
        setOutputFormat(next as LocalConversionResult["outputFormat"]);
        return;
      }
    }
  };

  const chooseFiles = (list: FileList | null, input: HTMLInputElement) => {
    setError(null);
    if (!list || list.length < 1) {
      setFiles([]);
      return;
    }
    const selected: File[] = [];
    let total = 0;
    for (let index = 0; index < list.length; index += 1) {
      const current = list.item(index);
      if (!current) continue;
      total += current.size;
      selected.push(current);
    }
    const maximumFiles = capability.limits.maxFiles ?? 1;
    const exceedsGlobalMaximum = selected.some((file) => file.size > 25 * 1024 * 1024);
    if (
      selected.length < 1 ||
      selected.length > maximumFiles ||
      selected.some((file) => file.size < 1 || file.size > capability.limits.maxInputBytes) ||
      (capability.limits.maxTotalBytes !== undefined && total > capability.limits.maxTotalBytes)
    ) {
      setFiles([]);
      setError(exceedsGlobalMaximum ? "文件超过 25 MiB，请选择更小的文件" : "文件超出本地处理限制");
      input.value = "";
      return;
    }
    setFiles(Object.freeze(selected));
    setStatus(`已选择 ${selected.length} 个本地文件，尚未读取内容`);
  };

  const cancel = () => {
    runSequence.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setRunning(false);
    setStatus("本地转换已取消");
  };

  const convert = async () => {
    if (running || files.length < 1) return;
    const controller = new AbortController();
    activeController.current = controller;
    const sequence = runSequence.current + 1;
    runSequence.current = sequence;
    setRunning(true);
    setError(null);
    setStatus("正在浏览器内转换，文件不会上传");
    try {
      const result = await services.run({ files, operation, outputFormat }, controller.signal);
      if (controller.signal.aborted || runSequence.current !== sequence) return;
      services.download(result.bytes, result.mediaType, result.downloadName);
      setCompleted((value) => value + 1);
      setStatus("转换完成，文件未离开浏览器");
    } catch {
      if (controller.signal.aborted || runSequence.current !== sequence) return;
      setError("本地转换失败，请检查文件格式与大小");
      setStatus("本地转换未完成");
    } finally {
      if (runSequence.current === sequence) {
        activeController.current = null;
        setRunning(false);
      }
    }
  };

  return (
    <section className="conversion-card local-card" aria-labelledby={titleId}>
      <div className="conversion-heading">
        <span className="conversion-icon green">
          <HardDrive size={26} />
        </span>
        <div>
          <span className="status-pill">推荐</span>
          <h2 id={titleId}>本地处理</h2>
          <p>7 项能力均在当前浏览器运行，不登录、不上传</p>
        </div>
      </div>

      <div className="conversion-controls">
        <label>
          <span>本地转换类型</span>
          <select
            value={operation}
            onChange={(event) => changeOperation(event.currentTarget.value)}
          >
            {LOCAL_BROWSER_CAPABILITIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>输出格式</span>
          <select
            value={outputFormat}
            onChange={(event) => changeOutput(event.currentTarget.value)}
          >
            {capability.outputFormats.map((format) => (
              <option key={format} value={format}>
                {formatLabel(format)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="file-drop local-drop">
        <input
          key={operation}
          type="file"
          aria-label="选择本地转换文件"
          accept={LOCAL_FILE_ACCEPT}
          multiple={operation === "pdf.organize" || operation === "images.to.pdf"}
          onChange={(event) => chooseFiles(event.currentTarget.files, event.currentTarget)}
        />
        <FileUp size={31} />
        <strong>
          {files.length === 1
            ? files[0]?.name
            : files.length > 1
              ? `已选择 ${files.length} 个文件`
              : "点击或拖拽文件到此处"}
        </strong>
        <span>支持 TXT、Markdown、HTML、DOCX、PDF 与常用图片；具体操作按格式显示</span>
        <span>单个文件不超过 25 MiB；文本能力上限为 10 MiB</span>
        <span>内容只会在点击“本地转换”后读取</span>
        {error && <span role="alert">{error}</span>}
        {files.length > 0 && <em>文件已在本机就绪</em>}
      </label>

      <div className="conversion-actions">
        <button
          type="button"
          className="primary-action"
          disabled={running || files.length < 1}
          onClick={convert}
        >
          <CheckCircle2 size={15} /> 本地转换
        </button>
        {running && (
          <button type="button" className="secondary-action" onClick={cancel}>
            <XCircle size={15} /> 取消本地转换
          </button>
        )}
      </div>

      <output className="local-conversion-status" aria-live="polite">
        {status}
      </output>
      <div className="boundary-note">
        <ShieldCheck size={17} />
        <span>
          <strong>文件不会离开您的设备</strong>
          本次会话已完成 {completed} 项；记录不含源文件名或正文。
        </span>
      </div>
    </section>
  );
}
