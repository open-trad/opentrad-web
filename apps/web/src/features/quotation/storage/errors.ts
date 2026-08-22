export type LocalDataErrorCode =
  | "CORRUPT_DATA"
  | "STORAGE_BLOCKED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_QUOTA"
  | "STORAGE_WRITE_FAILED";

const messages: Record<LocalDataErrorCode, string> = {
  CORRUPT_DATA: "本地草稿数据已损坏，请删除该草稿后重试",
  STORAGE_BLOCKED: "本地数据升级被其他页面阻塞，请关闭其他 OpenTrad 页面后重试",
  STORAGE_QUOTA: "浏览器存储空间不足，请导出备份并清理旧草稿",
  STORAGE_UNAVAILABLE: "当前浏览器无法使用本地存储，请检查隐私设置后重试",
  STORAGE_WRITE_FAILED: "本地数据保存失败，请重试",
};

export class LocalDataError extends Error {
  readonly code: LocalDataErrorCode;

  constructor(code: LocalDataErrorCode) {
    super(messages[code]);
    this.name = "LocalDataError";
    this.code = code;
  }
}

export function normalizeLocalDataError(error: unknown): LocalDataError {
  if (error instanceof LocalDataError) {
    return error;
  }
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") {
      return new LocalDataError("STORAGE_QUOTA");
    }
    if (error.name === "SecurityError" || error.name === "VersionError") {
      return new LocalDataError("STORAGE_UNAVAILABLE");
    }
  }
  return new LocalDataError("STORAGE_WRITE_FAILED");
}
