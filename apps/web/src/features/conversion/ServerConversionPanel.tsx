import {
  BID_TEMPLATE_IDS,
  CAPABILITIES,
  type ConversionCapability,
  type CreateJobRequest,
  CreateJobRequestSchema,
  type FileFormat,
  type JobStatus,
} from "@opentrad/contracts";
import {
  CheckCircle2,
  CloudCog,
  Download,
  FileArchive,
  FileUp,
  LockKeyhole,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AccountPanel, type AccountPanelClient } from "../auth/AccountPanel";
import { accountClient as defaultAccountClient } from "../auth/authClient";
import { downloadJobResult } from "./downloadJobResult";
import { cancelServerJob, readServerJob, submitServerJob } from "./serverConversionClient";
import { type ServerConversionServices, useConversionJob } from "./useConversionJob";

export type { ServerConversionServices } from "./useConversionJob";

export const SERVER_FEATURES_ENABLED =
  import.meta.env.VITE_DEPLOYMENT_MODE === "production" &&
  window.location.hostname === "opentrad.dns.army";

const serverCapabilities = Object.freeze(
  CAPABILITIES.filter((capability) => capability.execution === "server"),
);

const defaultServices: ServerConversionServices = Object.freeze({
  cancel: cancelServerJob,
  download: downloadJobResult,
  randomUUID: () => crypto.randomUUID(),
  read: readServerJob,
  submit: submitServerJob,
});

const extensionFormats = Object.freeze([
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pptx", "pptx"],
  [".opentrad", "opentrad"],
  [".html", "html"],
  [".webp", "webp"],
  [".avif", "avif"],
  [".doc", "doc"],
  [".odt", "odt"],
  [".rtf", "rtf"],
  [".xls", "xls"],
  [".ods", "ods"],
  [".ppt", "ppt"],
  [".odp", "odp"],
  [".pdf", "pdf"],
  [".png", "png"],
  [".jpg", "jpg"],
  [".jpeg", "jpg"],
  [".md", "md"],
] as const);

function inferFormat(name: string): FileFormat | undefined {
  const lower = name.toLowerCase();
  for (const [extension, format] of extensionFormats) {
    if (lower.endsWith(extension)) return format;
  }
  return undefined;
}

function includesFormat(values: readonly FileFormat[], value: FileFormat): boolean {
  return values.some((item) => item === value);
}

function accept(capability: ConversionCapability): string {
  return extensionFormats
    .filter(([, format]) => includesFormat(capability.inputFormats, format))
    .map(([extension]) => extension)
    .join(",");
}

export function buildServerJobRequest(
  operation: ConversionCapability["id"],
  inputFormat: FileFormat,
  outputFormat: FileFormat,
  inputBytes: number,
  bidTemplateId: (typeof BID_TEMPLATE_IDS)[number],
): CreateJobRequest {
  const options =
    operation === "bid.assemble"
      ? { templateId: bidTemplateId, templateVersion: "1.0.0" as const }
      : operation === "ocr.pdf" || operation === "ocr.image"
        ? { language: "chi_sim+eng" as const }
        : {};
  return CreateJobRequestSchema.parse({
    inputBytes,
    inputFormat,
    operation,
    options,
    outputFormat,
  });
}

function jobStatus(job: JobStatus | null): string {
  if (!job) return "选择文件并确认后，才会上传本次任务";
  switch (job.status) {
    case "queued":
      return "排队中，当前最多仅保留 1 个等待任务";
    case "running":
      return "处理中，可随时取消";
    case "cancelling":
      return "正在取消，请稍候";
    case "cancelled":
      return "已取消";
    case "failed":
      return "处理失败，文件将按清理策略删除";
    case "succeeded":
      return "处理完成，请在 15 分钟内下载";
  }
}

function ServerPreview() {
  return (
    <section className="conversion-card server-card">
      <div className="conversion-heading">
        <span className="conversion-icon blue">
          <CloudCog size={26} />
        </span>
        <div>
          <span className="status-pill blue">增强能力</span>
          <h2>服务器增强</h2>
          <p>生产站点才开放登录、上传与任务处理</p>
        </div>
      </div>
      <div className="server-preview-note">
        <LockKeyhole aria-hidden="true" />
        <p>GitHub Pages 为本地功能预览；服务器转换仅在 opentrad.dns.army 开放。</p>
      </div>
    </section>
  );
}

function EnabledServerConversionPanel({
  account,
  services,
}: {
  readonly account: AccountPanelClient;
  readonly services: ServerConversionServices;
}) {
  const firstCapability = serverCapabilities[0];
  if (!firstCapability) throw new Error("SERVER_CAPABILITIES_UNAVAILABLE");
  const session = account.useSession();
  const [operation, setOperation] = useState(firstCapability.id);
  const [outputFormat, setOutputFormat] = useState(firstCapability.outputFormats[0] ?? "pdf");
  const [file, setFile] = useState<File | null>(null);
  const [inputFormat, setInputFormat] = useState<FileFormat | null>(null);
  const [consent, setConsent] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [bidTemplateId, setBidTemplateId] = useState<(typeof BID_TEMPLATE_IDS)[number]>(
    BID_TEMPLATE_IDS[0],
  );
  const capability = useMemo(
    () => serverCapabilities.find((item) => item.id === operation) ?? firstCapability,
    [firstCapability, operation],
  );
  const lifecycle = useConversionJob(services);

  function changeOperation(next: string): void {
    const selected = serverCapabilities.find((item) => item.id === next);
    if (!selected) return;
    setOperation(selected.id);
    setOutputFormat(selected.outputFormats[0] ?? "pdf");
    setFile(null);
    setInputFormat(null);
    setConsent(false);
    setSelectionError("");
  }

  function chooseFile(next: File | undefined, input: HTMLInputElement): void {
    setSelectionError("");
    setConsent(false);
    if (!next) {
      setFile(null);
      setInputFormat(null);
      return;
    }
    const format = inferFormat(next.name);
    if (
      !format ||
      !includesFormat(capability.inputFormats, format) ||
      next.size < 1 ||
      next.size > capability.limits.maxInputBytes
    ) {
      setFile(null);
      setInputFormat(null);
      setSelectionError("文件格式或大小不符合当前服务器能力限制");
      input.value = "";
      return;
    }
    setFile(next);
    setInputFormat(format);
  }

  async function submit(): Promise<void> {
    if (!file || !inputFormat || !consent) return;
    try {
      await lifecycle.submit(
        buildServerJobRequest(operation, inputFormat, outputFormat, file.size, bidTemplateId),
        file,
      );
    } catch {
      setSelectionError("任务参数不受支持，请重新选择转换类型");
    }
  }

  function clearSelection(): void {
    setFile(null);
    setInputFormat(null);
    setConsent(false);
    setSelectionError("");
  }

  async function download(): Promise<void> {
    if (await lifecycle.download()) clearSelection();
  }

  function startNewTask(): void {
    lifecycle.reset();
    clearSelection();
  }

  return (
    <section className="conversion-card server-card">
      <div className="conversion-heading">
        <span className="conversion-icon blue">
          <CloudCog size={26} />
        </span>
        <div>
          <span className="status-pill blue">增强能力</span>
          <h2>服务器增强</h2>
          <p>9 项能力仅在登录、选中文件并逐次同意后上传</p>
        </div>
      </div>
      <AccountPanel client={account} />
      {session.data ? (
        <>
          <div className="conversion-controls server-conversion-controls">
            <label>
              <span>服务器转换类型</span>
              <select
                value={operation}
                onChange={(event) => changeOperation(event.currentTarget.value)}
              >
                {serverCapabilities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.quality} 级
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>输出格式</span>
              <select
                value={outputFormat}
                onChange={(event) => setOutputFormat(event.currentTarget.value as FileFormat)}
              >
                {capability.outputFormats.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {operation === "bid.assemble" ? (
            <label className="server-bid-template">
              <span>标书模板</span>
              <select
                value={bidTemplateId}
                onChange={(event) =>
                  setBidTemplateId(event.currentTarget.value as (typeof BID_TEMPLATE_IDS)[number])
                }
              >
                {BID_TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id} · 1.0.0
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="file-drop server-drop">
            <input
              key={operation}
              type="file"
              aria-label="选择服务器处理文件"
              accept={accept(capability)}
              disabled={lifecycle.busy || lifecycle.job !== null}
              onChange={(event) => chooseFile(event.currentTarget.files?.[0], event.currentTarget)}
            />
            <FileUp size={31} />
            <strong>{file ? file.name : "选择本次服务器处理文件"}</strong>
            <span>选择文件不会立即上传；提交后文件名统一改为 upload.bin</span>
            <span>单任务完成、取消、失败或超时后按隐私策略清理</span>
            {selectionError ? <span role="alert">{selectionError}</span> : null}
          </label>
          <label className="server-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={!file || lifecycle.busy || lifecycle.job !== null}
              onChange={(event) => setConsent(event.currentTarget.checked)}
            />
            我同意本次文件上传到 OpenTrad 服务器处理
          </label>
          <div className="conversion-actions">
            <button
              type="button"
              className="primary-action server-primary-action"
              disabled={
                !file || !inputFormat || !consent || lifecycle.busy || lifecycle.job !== null
              }
              onClick={() => void submit()}
            >
              <CheckCircle2 aria-hidden="true" /> 提交服务器处理
            </button>
            {lifecycle.job &&
            (lifecycle.job.status === "queued" ||
              lifecycle.job.status === "running" ||
              lifecycle.job.status === "cancelling") ? (
              <button
                type="button"
                className="secondary-action"
                disabled={lifecycle.busy || lifecycle.job.status === "cancelling"}
                onClick={() => void lifecycle.cancel()}
              >
                <XCircle aria-hidden="true" /> 取消任务
              </button>
            ) : null}
            {lifecycle.job?.status === "succeeded" ? (
              <button
                type="button"
                className="primary-action server-primary-action"
                disabled={lifecycle.busy}
                onClick={() => void download()}
              >
                <Download aria-hidden="true" /> 下载处理结果
              </button>
            ) : null}
            {lifecycle.job?.status === "cancelled" || lifecycle.job?.status === "failed" ? (
              <button type="button" className="secondary-action" onClick={startNewTask}>
                <FileArchive aria-hidden="true" /> 开始新任务
              </button>
            ) : null}
          </div>
          <output aria-live="polite" className="server-job-status">
            {jobStatus(lifecycle.job)}
          </output>
          {lifecycle.error ? <p role="alert">{lifecycle.error}</p> : null}
          <div className="boundary-note blue">
            <LockKeyhole aria-hidden="true" />
            <span>
              <strong>每次上传都需要单独确认</strong>
              结果仅供一次性下载；本地编辑与本地转换仍无需登录。
            </span>
          </div>
        </>
      ) : (
        <div className="server-login-note">
          <FileArchive aria-hidden="true" />
          <p>登录后才会显示服务器文件选择与上传确认。</p>
        </div>
      )}
    </section>
  );
}

export function ServerConversionPanel({
  enabled = SERVER_FEATURES_ENABLED,
  account = defaultAccountClient,
  services = defaultServices,
}: {
  readonly enabled?: boolean;
  readonly account?: AccountPanelClient;
  readonly services?: ServerConversionServices;
}) {
  return enabled ? (
    <EnabledServerConversionPanel account={account} services={services} />
  ) : (
    <ServerPreview />
  );
}
