import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalConversionPanel, type LocalConversionPanelServices } from "./LocalConversionPanel";
import type { LocalConversionResult } from "./localConversionClient";

function file(name = "private-source.txt"): File {
  return new File(["OpenTrad"], name, { type: "text/plain" });
}

function services(
  overrides: Partial<LocalConversionPanelServices> = {},
): LocalConversionPanelServices {
  return {
    download: vi.fn(),
    run: vi.fn(async () => ({
      bytes: new Uint8Array([0x4f, 0x54]),
      downloadName: "opentrad-local-text-semantic.md",
      mediaType: "text/markdown",
      outputFormat: "md" as const,
    })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("local-first conversion panel", () => {
  it("shows all seven contract capabilities and does no work before the explicit click", async () => {
    const local = services();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<LocalConversionPanel services={local} />);

    expect(screen.getAllByRole("option")).toHaveLength(10);
    await user.upload(screen.getByLabelText("选择本地转换文件"), file());
    expect(local.run).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "本地转换" }));

    expect(await screen.findByText("转换完成，文件未离开浏览器")).toBeVisible();
    expect(local.run).toHaveBeenCalledTimes(1);
    expect(local.download).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "text/markdown",
      "opentrad-local-text-semantic.md",
    );
    expect(window.location.href).not.toContain("private-source");
    expect(localStorage.length).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("switches output choices from the selected contract capability", async () => {
    const user = userEvent.setup();
    render(<LocalConversionPanel services={services()} />);

    await user.selectOptions(screen.getByLabelText("本地转换类型"), "image.convert");
    expect(screen.getByLabelText("输出格式")).toHaveValue("png");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["PNG", "JPG", "WEBP", "AVIF"]),
    );
  });

  it("cancels an active conversion and aborts it again on unmount", async () => {
    let activeSignal: AbortSignal | undefined;
    const local = services({
      run: vi.fn((_input, signal) => {
        activeSignal = signal;
        return new Promise<LocalConversionResult>(() => undefined);
      }),
    });
    const user = userEvent.setup();
    const view = render(<LocalConversionPanel services={local} />);
    await user.upload(screen.getByLabelText("选择本地转换文件"), file());
    await user.click(screen.getByRole("button", { name: "本地转换" }));
    await user.click(screen.getByRole("button", { name: "取消本地转换" }));
    expect(activeSignal?.aborted).toBe(true);

    await user.upload(screen.getByLabelText("选择本地转换文件"), file("second.txt"));
    await user.click(screen.getByRole("button", { name: "本地转换" }));
    await waitFor(() => expect(activeSignal?.aborted).toBe(false));
    view.unmount();
    expect(activeSignal?.aborted).toBe(true);
  });

  it("ignores a result that arrives after cancellation or unmount", async () => {
    const pending: Array<(result: LocalConversionResult) => void> = [];
    const local = services({
      run: vi.fn(
        () =>
          new Promise<LocalConversionResult>((resolve) => {
            pending.push(resolve);
          }),
      ),
    });
    const user = userEvent.setup();
    const view = render(<LocalConversionPanel services={local} />);
    await user.upload(screen.getByLabelText("选择本地转换文件"), file());
    await user.click(screen.getByRole("button", { name: "本地转换" }));
    await user.click(screen.getByRole("button", { name: "取消本地转换" }));
    pending[0]?.({
      bytes: new Uint8Array([1]),
      downloadName: "late.txt",
      mediaType: "text/plain",
      outputFormat: "txt",
    });
    await waitFor(() => expect(local.download).not.toHaveBeenCalled());
    expect(screen.getByText("本地转换已取消")).toBeVisible();
    expect(screen.getByText(/本次会话已完成 0 项/u)).toBeVisible();

    await user.upload(screen.getByLabelText("选择本地转换文件"), file("second.txt"));
    await user.click(screen.getByRole("button", { name: "本地转换" }));
    view.unmount();
    pending[1]?.({
      bytes: new Uint8Array([2]),
      downloadName: "unmounted.txt",
      mediaType: "text/plain",
      outputFormat: "txt",
    });
    await Promise.resolve();
    expect(local.download).not.toHaveBeenCalled();
  });

  it("rejects oversized selections before invoking the runtime", async () => {
    const local = services();
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.txt", {
      type: "text/plain",
    });
    const user = userEvent.setup();
    render(<LocalConversionPanel services={local} />);

    await user.upload(screen.getByLabelText("选择本地转换文件"), oversized);

    expect(screen.getByRole("alert")).toHaveTextContent("文件超出本地处理限制");
    expect(local.run).not.toHaveBeenCalled();
  });
});
