import { describe, expect, it, vi } from "vitest";
import {
  convertSemanticText,
  dispatchSemanticTextConversion,
  installLocalConversionWorker,
  sanitizeHtmlFragment,
  TEXT_CONVERSION_LIMITS,
} from "../src/index.js";

const utf8 = new TextEncoder();
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);

async function convertString(
  source: string,
  input: "txt" | "md" | "html",
  output: "txt" | "md" | "html",
  signal?: AbortSignal,
): Promise<string> {
  return decodeUtf8(await convertSemanticText(utf8.encode(source), input, output, "utf-8", signal));
}

interface WorkerPost {
  readonly message: unknown;
  readonly exactTransfer: boolean;
}

class TextWorkerScope {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly posts: WorkerPost[] = [];

  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const bytes =
      message !== null && typeof message === "object"
        ? (message as { readonly bytes?: Uint8Array }).bytes
        : undefined;
    this.posts.push({
      exactTransfer:
        transfer.length === 1 && bytes instanceof Uint8Array && transfer[0] === bytes.buffer,
      message: structuredClone(message, { transfer }),
    });
  }

  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
}

describe("strict text decoding", () => {
  it("decodes GB18030 and strips UTF-8 and GB18030 BOMs", async () => {
    const gb18030 = new Uint8Array([0xbf, 0xaa, 0xd4, 0xb4, 0xc9, 0xcc, 0xc3, 0xb3]);
    expect(decodeUtf8(await convertSemanticText(gb18030, "txt", "txt", "gb18030"))).toBe(
      "开源商贸",
    );

    expect(await convertString("\uFEFFOpenTrad", "txt", "txt")).toBe("OpenTrad");
    expect(
      decodeUtf8(
        await convertSemanticText(
          new Uint8Array([0x84, 0x31, 0x95, 0x33, 0x41]),
          "txt",
          "txt",
          "gb18030",
        ),
      ),
    ).toBe("A");
  });

  it("fails closed on malformed sequences and a BOM-proven encoding mismatch", async () => {
    await expect(
      convertSemanticText(new Uint8Array([0xc3, 0x28]), "txt", "txt", "utf-8"),
    ).rejects.toThrow("LOCAL_TEXT_DECODE_FAILED");
    await expect(
      convertSemanticText(new Uint8Array([0x81]), "txt", "txt", "gb18030"),
    ).rejects.toThrow("LOCAL_TEXT_DECODE_FAILED");
    await expect(
      convertSemanticText(utf8.encode("\uFEFF开源商贸"), "txt", "txt", "gb18030"),
    ).rejects.toThrow("LOCAL_TEXT_ENCODING_MISMATCH");
  });

  it("honors explicit GB18030 for byte sequences that also form valid UTF-8", async () => {
    for (const [bytes, expected] of [
      [new Uint8Array([0xc2, 0xa3]), "拢"],
      [new Uint8Array([0xd0, 0xa1]), "小"],
    ] as const) {
      expect(decodeUtf8(await convertSemanticText(bytes, "txt", "txt", "gb18030"))).toBe(expected);
    }
  });

  it("normalizes NFKC and newlines but rejects XML and control characters", async () => {
    expect(await convertString("ＡＢＣ\r\n①\r商贸", "txt", "txt")).toBe("ABC\n1\n商贸");

    for (const source of ["safe\u0000bad", "safe\u007Fbad", "safe\uFFFEbad"]) {
      await expect(convertString(source, "txt", "txt")).rejects.toThrow(
        "LOCAL_TEXT_INVALID_CHARACTERS",
      );
    }
  });

  it("returns stable errors without preserving content, causes, or abort reasons", async () => {
    const controller = new AbortController();
    controller.abort({ filename: "private.txt", bytes: [65, 66, 67] });
    let caught: unknown;
    try {
      await convertSemanticText(
        utf8.encode("private body"),
        "txt",
        "html",
        "utf-8",
        controller.signal,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ message: "LOCAL_CONVERSION_CANCELLED", name: "Error" });
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(caught)).not.toMatch(/private|65|66|67/i);
  });

  it("rejects non-string sanitizer input without invoking coercion hooks", async () => {
    let coercionCalls = 0;
    const hostile = {
      toString() {
        coercionCalls += 1;
        return '<script src="https://private.test/x"></script>';
      },
    };
    const sanitizeUnknown = sanitizeHtmlFragment as (value: unknown) => Promise<string>;
    await expect(sanitizeUnknown(hostile)).rejects.toThrow("LOCAL_TEXT_INPUT_INVALID");
    expect(coercionCalls).toBe(0);
  });
});

describe("deterministic semantic conversion", () => {
  it("converts every txt/md/html pair deterministically to UTF-8", async () => {
    const fixtures = {
      txt: "Title\r\n\r\nBody",
      md: "# Title\r\n\r\nBody",
      html: "<h1>Title</h1><p>Body</p>",
    } as const;
    for (const input of ["txt", "md", "html"] as const) {
      for (const output of ["txt", "md", "html"] as const) {
        const first = await convertString(fixtures[input], input, output);
        const second = await convertString(fixtures[input], input, output);
        expect(second).toBe(first);
        expect(first).not.toContain("\r");
      }
    }
  });

  it("preserves headings and readable text across Markdown, HTML, and TXT", async () => {
    expect(await convertString("# 标题\n\n正文", "md", "html")).toBe("<h1>标题</h1>\n<p>正文</p>");
    expect(await convertString("<h1>标题</h1><p>正文</p>", "html", "md")).toBe("# 标题\n\n正文\n");
    expect(await convertString("# 标题\n\n正文", "md", "txt")).toBe("标题\n\n正文");
  });

  it("sanitizes HTML without scripts, styles, events, URL attributes, or fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    try {
      const source = [
        '<h1 onclick="alert(1)" style="background:url(https://bad.test/x)">标题</h1>',
        "<script>alert(2)</script><style>@import 'https://bad.test/x';</style>",
        '<a href="javascript:alert(3)">危险</a><a href="https://outside.test/x">外链</a>',
        '<img src="https://tracker.test/pixel" onerror="alert(4)">',
        '<iframe srcdoc="private"></iframe><form action="https://outside.test"><input></form>',
      ].join("");
      const html = await convertString(source, "html", "html");
      expect(html).toContain("<h1>标题</h1>");
      expect(html).toContain("<a>危险</a><a>外链</a>");
      expect(html).not.toMatch(
        /script|style|onclick|onerror|javascript:|https?:|href=|src=|iframe|form|input|@import/i,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("removes raw HTML, active links, and remote images from Markdown outputs", async () => {
    const source = [
      "# 标题",
      "",
      '<script>alert("x")</script>',
      "",
      "[危险](javascript:alert(1)) [外链](https://outside.test/x)",
      "",
      "![跟踪](https://tracker.test/pixel)",
      "",
      '<strong onclick="alert(2)">raw</strong>',
    ].join("\n");
    for (const output of ["md", "html"] as const) {
      const result = await convertString(source, "md", output);
      expect(result).toContain("标题");
      expect(result).not.toMatch(/<script|<strong|javascript:|https?:|href=|src=/i);
    }
  });
});

describe("bounded conversion and worker integration", () => {
  it("enforces input, output, node, and depth budgets", async () => {
    await expect(
      convertSemanticText(
        new Uint8Array(TEXT_CONVERSION_LIMITS.maxInputBytes + 1),
        "txt",
        "txt",
        "utf-8",
      ),
    ).rejects.toThrow("LOCAL_TEXT_INPUT_TOO_LARGE");

    const expanding = "&".repeat(Math.floor(TEXT_CONVERSION_LIMITS.maxOutputBytes / 6) + 1);
    await expect(convertString(expanding, "txt", "html")).rejects.toThrow(
      "LOCAL_TEXT_OUTPUT_TOO_LARGE",
    );
    await expect(sanitizeHtmlFragment(expanding)).rejects.toThrow("LOCAL_TEXT_OUTPUT_TOO_LARGE");

    const nodeBomb = "<i>x</i>".repeat(Math.floor(TEXT_CONVERSION_LIMITS.maxNodes / 2) + 1);
    await expect(convertString(nodeBomb, "html", "txt")).rejects.toThrow(
      "LOCAL_TEXT_NODE_LIMIT_EXCEEDED",
    );

    const depthBomb = `${"<blockquote>".repeat(TEXT_CONVERSION_LIMITS.maxDepth + 1)}x${"</blockquote>".repeat(TEXT_CONVERSION_LIMITS.maxDepth + 1)}`;
    await expect(convertString(depthBomb, "html", "txt")).rejects.toThrow(
      "LOCAL_TEXT_NODE_LIMIT_EXCEEDED",
    );
  });

  it("honors abort-before and abort-inflight checkpoints", async () => {
    const before = new AbortController();
    before.abort();
    await expect(convertString("body", "txt", "html", before.signal)).rejects.toThrow(
      "LOCAL_CONVERSION_CANCELLED",
    );

    const active = new AbortController();
    const pending = convertString("body".repeat(10_000), "txt", "html", active.signal);
    active.abort();
    await expect(pending).rejects.toThrow("LOCAL_CONVERSION_CANCELLED");
  });

  it("runs text.semantic through the strict one-request worker protocol", async () => {
    const scope = new TextWorkerScope();
    installLocalConversionWorker(scope, dispatchSemanticTextConversion);
    const id = crypto.randomUUID();
    scope.emit({
      id,
      operation: "text.semantic",
      inputFormat: "md",
      outputFormat: "html",
      bytes: utf8.encode("# OpenTrad"),
      options: { encoding: "utf-8" },
    });
    await vi.waitFor(() => expect(scope.posts).toHaveLength(1));
    expect(scope.posts[0]?.exactTransfer).toBe(true);
    const response = scope.posts[0]?.message as {
      readonly id: string;
      readonly ok: boolean;
      readonly bytes: Uint8Array;
      readonly mediaType: string;
    };
    expect(response).toMatchObject({ id, ok: true, mediaType: "text/html" });
    expect(decodeUtf8(response.bytes)).toBe("<h1>OpenTrad</h1>");
  });

  it("maps decoder failures to a fixed worker error without logging input", async () => {
    const scope = new TextWorkerScope();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      installLocalConversionWorker(scope, dispatchSemanticTextConversion);
      const id = crypto.randomUUID();
      scope.emit({
        id,
        operation: "text.semantic",
        inputFormat: "txt",
        outputFormat: "html",
        bytes: new Uint8Array([0xc3, 0x28]),
        options: { encoding: "utf-8" },
      });
      await vi.waitFor(() => expect(scope.posts).toHaveLength(1));
      expect(scope.posts[0]?.message).toEqual({
        id,
        ok: false,
        code: "LOCAL_CONVERSION_FAILED",
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
