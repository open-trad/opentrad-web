import { describe, expect, it } from "vitest";
import { normalizeLocalDataError } from "./errors";

describe("finite local storage errors", () => {
  it.each([
    ["QuotaExceededError", "STORAGE_QUOTA", "浏览器存储空间不足，请导出备份并清理旧草稿"],
    ["AbortError", "STORAGE_WRITE_FAILED", "本地数据保存失败，请重试"],
    ["SecurityError", "STORAGE_UNAVAILABLE", "当前浏览器无法使用本地存储，请检查隐私设置后重试"],
  ])("maps %s without exposing the raw browser message", (name, code, message) => {
    expect(normalizeLocalDataError(new DOMException("raw private detail", name))).toMatchObject({
      code,
      message,
    });
  });
});
