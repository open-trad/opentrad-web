import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConvertPage } from "../../pages/ConvertPage";
import type { LocalConversionPanelServices } from "./LocalConversionPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("runs the integrated local panel without session or network access", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const services: LocalConversionPanelServices = {
    download: vi.fn(),
    run: vi.fn(async () => ({
      bytes: new TextEncoder().encode("# OpenTrad"),
      downloadName: "opentrad-local-text-semantic.md",
      mediaType: "text/markdown",
      outputFormat: "md" as const,
    })),
  };
  const user = userEvent.setup();
  render(<ConvertPage localServices={services} />);

  expect(screen.getByRole("heading", { name: "格式转换" })).toBeVisible();
  expect(
    screen.getByText("GitHub Pages 为本地功能预览；服务器转换仅在 opentrad.dynv6.net 开放。"),
  ).toBeVisible();
  expect(screen.queryByLabelText("选择服务器处理文件")).not.toBeInTheDocument();
  await user.upload(
    screen.getByLabelText("选择本地转换文件"),
    new File(["OpenTrad"], "private.txt", { type: "text/plain" }),
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "本地转换" }));

  expect(await screen.findByText("转换完成，文件未离开浏览器")).toBeVisible();
  expect(services.run).toHaveBeenCalledTimes(1);
  expect(fetchSpy).not.toHaveBeenCalled();
});
