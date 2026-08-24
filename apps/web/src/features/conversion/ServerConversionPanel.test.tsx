import { type JobStatus, JobStatusSchema } from "@opentrad/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPanelClient } from "../auth/AccountPanel";
import {
  buildServerJobRequest,
  ServerConversionPanel,
  type ServerConversionServices,
} from "./ServerConversionPanel";

const queued = JobStatusSchema.parse({
  createdAt: "2026-08-22T00:00:00.000Z",
  expiresAt: "2026-08-22T00:15:00.000Z",
  id: "00000000-0000-4000-8000-000000000013",
  operation: "office.to.pdf",
  progress: { completed: 0, phase: "queued", total: 1 },
  quality: "B",
  queuePosition: 1,
  status: "queued",
});
const cancelled = JobStatusSchema.parse({
  createdAt: queued.createdAt,
  expiresAt: queued.expiresAt,
  id: queued.id,
  operation: queued.operation,
  quality: "B",
  status: "cancelled",
});

function account(loggedIn = true): AccountPanelClient {
  return {
    loadOptions: vi.fn(async () => ({ githubEnabled: false })),
    register: vi.fn(async () => undefined),
    signInGithub: vi.fn(async () => undefined),
    signInUsername: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    useSession: () => ({
      data: loggedIn ? { user: { username: "trade_user" } } : null,
      isPending: false,
      refetch: vi.fn(async () => undefined),
    }),
  };
}

function services(): ServerConversionServices & Record<string, unknown> {
  return {
    cancel: vi.fn(async () => cancelled),
    download: vi.fn(async () => undefined),
    randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000099"),
    read: vi.fn(() => new Promise<JobStatus>(() => undefined)),
    submit: vi.fn(async () => queued),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("server conversion panel", () => {
  it.each([
    ["office.to.pdf", "docx", "pdf", {}],
    ["spreadsheet.to.csv", "xlsx", "csv", {}],
    ["structured.convert", "docx", "md", {}],
    ["ocr.pdf", "pdf", "txt", { language: "chi_sim+eng" }],
    ["ocr.image", "png", "txt", { language: "chi_sim+eng" }],
    ["image.convert.hq", "png", "webp", {}],
    ["pdf.repair", "pdf", "pdf", {}],
    ["pdf.text-to-docx", "pdf", "docx", {}],
    [
      "bid.assemble",
      "opentrad",
      "pdf",
      { templateId: "bid.enterprise.services.v1", templateVersion: "1.0.0" },
    ],
  ] as const)("builds the exact %s server request", (operation, input, output, options) => {
    expect(
      buildServerJobRequest(operation, input, output, 7, "bid.enterprise.services.v1"),
    ).toEqual({ inputBytes: 7, inputFormat: input, operation, options, outputFormat: output });
  });

  it("renders preview copy without login, upload, or auth requests when production is disabled", () => {
    const runtime = account(false);
    render(<ServerConversionPanel enabled={false} account={runtime} services={services()} />);

    expect(screen.getByText("服务器转换仅在正式生产站点开放。")).toBeVisible();
    expect(screen.queryByLabelText("选择服务器处理文件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
    expect(runtime.loadOptions).not.toHaveBeenCalled();
  });

  it("requires login, a valid file, and explicit per-upload consent", async () => {
    const jobs = services();
    const user = userEvent.setup();
    render(<ServerConversionPanel enabled account={account()} services={jobs} />);

    const submit = screen.getByRole("button", { name: "提交服务器处理" });
    expect(submit).toBeDisabled();
    await user.upload(
      screen.getByLabelText("选择服务器处理文件"),
      new File(["private"], "private.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    expect(submit).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: "我同意本次文件上传到 OpenTrad 服务器处理",
      }),
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(jobs.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        inputBytes: 7,
        inputFormat: "docx",
        operation: "office.to.pdf",
        outputFormat: "pdf",
      }),
      expect.any(File),
      "00000000-0000-4000-8000-000000000099",
      expect.any(AbortSignal),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "排队中，当前最多仅保留 1 个等待任务",
    );
    await user.click(screen.getByRole("button", { name: "取消任务" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已取消");
    await user.click(screen.getByRole("button", { name: "开始新任务" }));
    expect(screen.getByLabelText("选择服务器处理文件")).toBeEnabled();
    expect(
      screen.getByRole("checkbox", {
        name: "我同意本次文件上传到 OpenTrad 服务器处理",
      }),
    ).not.toBeChecked();
  });

  it("keeps server file controls locked while explaining login and separate confirmation", () => {
    render(<ServerConversionPanel enabled account={account(false)} services={services()} />);

    expect(screen.getByText("登录后即可使用服务器转换；每次上传都需要单独确认。")).toBeVisible();
    expect(screen.queryByLabelText("选择服务器处理文件")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交服务器处理" })).not.toBeInTheDocument();
  });
});
