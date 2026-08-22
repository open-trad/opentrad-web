import { JobStatusSchema } from "@opentrad/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { downloadJobResult, saveServerResult } from "./downloadJobResult";

const succeeded = JobStatusSchema.parse({
  createdAt: "2026-08-22T00:00:00.000Z",
  expiresAt: "2026-08-22T00:15:00.000Z",
  id: "00000000-0000-4000-8000-000000000012",
  operation: "office.to.pdf",
  quality: "B",
  result: { mediaType: "application/pdf", ready: true, sizeBytes: 5 },
  status: "succeeded",
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("downloads an exact validated one-shot result under a fixed local name", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      headers: { "content-length": "5", "content-type": "application/pdf" },
      status: 200,
    }),
  );
  const save = vi.fn();

  await downloadJobResult(succeeded, new AbortController().signal, save);

  expect(save).toHaveBeenCalledWith(
    expect.any(Uint8Array),
    "application/pdf",
    "opentrad-server-office-to-pdf.pdf",
  );
});

it("rejects a mismatched result before creating a download", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      headers: { "content-length": "5", "content-type": "text/plain" },
      status: 200,
    }),
  );
  const save = vi.fn();

  await expect(downloadJobResult(succeeded, new AbortController().signal, save)).rejects.toThrow(
    "SERVER_RESULT_INVALID",
  );
  expect(save).not.toHaveBeenCalled();
});

it("attaches the download and revokes its object URL after navigation has started", async () => {
  vi.useFakeTimers();
  const anchor = document.createElement("a");
  let attachedAtClick = false;
  const click = vi.spyOn(anchor, "click").mockImplementation(() => {
    attachedAtClick = document.body.contains(anchor);
  });
  vi.spyOn(document, "createElement").mockReturnValue(anchor);
  const createUrl = vi.fn(() => "blob:server-result");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revoke;
    },
  );

  saveServerResult(new Uint8Array([1]), "application/pdf", "fixed-result.pdf");

  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(anchor.download).toBe("fixed-result.pdf");
  expect(anchor.href).toBe("blob:server-result");
  expect(click).toHaveBeenCalledTimes(1);
  expect(attachedAtClick).toBe(true);
  expect(document.body).not.toContainElement(anchor);
  expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(revoke).toHaveBeenCalledWith("blob:server-result");
});
