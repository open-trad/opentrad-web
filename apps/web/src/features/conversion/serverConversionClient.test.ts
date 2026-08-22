import { type CreateJobRequest, JobStatusSchema } from "@opentrad/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelServerJob, readServerJob, submitServerJob } from "./serverConversionClient";

const queued = JobStatusSchema.parse({
  createdAt: "2026-08-22T00:00:00.000Z",
  expiresAt: "2026-08-22T00:15:00.000Z",
  id: "00000000-0000-4000-8000-000000000011",
  operation: "office.to.pdf",
  progress: { completed: 0, phase: "queued", total: 1 },
  quality: "B",
  queuePosition: 1,
  status: "queued",
});

const request: CreateJobRequest = {
  inputBytes: 7,
  inputFormat: "docx",
  operation: "office.to.pdf",
  options: {},
  outputFormat: "pdf",
};

afterEach(() => vi.restoreAllMocks());

describe("same-origin server conversion client", () => {
  it("submits one fixed-name file with exact consent, metadata, and idempotency headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job: queued }), {
        headers: { "content-type": "application/json" },
        status: 202,
      }),
    );
    const source = new File(["private"], "PRIVATE_FILENAME_SENTINEL.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    await expect(
      submitServerJob(
        request,
        source,
        "00000000-0000-4000-8000-000000000099",
        new AbortController().signal,
      ),
    ).resolves.toEqual(queued);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/jobs");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(init?.headers).toMatchObject({
      accept: "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-000000000099",
      "X-OpenTrad-Processing-Consent": "server-v1",
    });
    expect(
      JSON.parse((init?.headers as Record<string, string>)["X-OpenTrad-Job-Request"] ?? ""),
    ).toEqual(request);
    const body = init?.body as FormData;
    const upload = body.get("file") as File;
    expect(upload.name).toBe("upload.bin");
    expect(upload.size).toBe(7);
    expect(JSON.stringify([...body.entries()])).not.toContain("PRIVATE_FILENAME_SENTINEL");
  });

  it("uses same-origin credentials for polling and cancellation and rejects malformed jobs", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: queued }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: queued }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ job: { id: "private" } }), { status: 200 }),
      );
    const signal = new AbortController().signal;

    await readServerJob(queued.id, signal);
    await cancelServerJob(queued.id, signal);
    await expect(readServerJob(queued.id, signal)).rejects.toThrow("SERVER_JOB_REQUEST_FAILED");

    expect(fetchSpy.mock.calls.slice(0, 2)).toEqual([
      [
        `/api/v1/jobs/${queued.id}`,
        expect.objectContaining({ credentials: "same-origin", method: "GET", signal }),
      ],
      [
        `/api/v1/jobs/${queued.id}`,
        expect.objectContaining({ credentials: "same-origin", method: "DELETE", signal }),
      ],
    ]);
  });
});
