import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDownloadFilename, downloadBlob } from "./download";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("safe browser downloads", () => {
  it("normalizes Unicode and strips controls, bidi, path, and Windows-invalid characters", () => {
    expect(buildDownloadFilename("  ＱＴ/报价:001*?\u061c\u200e\u200f\u202e\u0000  ", "pdf")).toBe(
      "QT-报价-001.pdf",
    );
    expect(buildDownloadFilename("CON", "docx")).toBe("OpenTrad-报价单.docx");
    expect(buildDownloadFilename("...  ", "json")).toBe("OpenTrad-报价单.json");
    expect(Array.from(buildDownloadFilename("汉".repeat(120), "opentrad")).length).toBe(89);
  });

  it("removes the temporary anchor and revokes its object URL after a Safari-safe delay", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:opentrad-test");
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });

    downloadBlob(new Blob(["safe"]), "报价单.pdf");

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[href="blob:opentrad-test"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:opentrad-test");
  });

  it("still schedules object URL cleanup when the browser click fails", () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: () => "blob:failed-click" },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("browser denied download");
    });

    expect(() => downloadBlob(new Blob(["safe"]), "报价单.pdf")).toThrowError(
      "文件下载失败，请重试",
    );
    expect(document.querySelector('a[href="blob:failed-click"]')).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed-click");
  });
});
