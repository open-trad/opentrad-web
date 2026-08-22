import { describe, expect, it } from "vitest";

describe("pdfmake 0.3 browser bundle", () => {
  it("loads through Vite without the Roboto VFS and exposes the Promise client API", async () => {
    const loaded = await import("pdfmake/build/pdfmake");
    const candidate = (loaded as unknown as { default?: unknown }).default ?? loaded;
    expect(candidate).toMatchObject({
      addFonts: expect.any(Function),
      createPdf: expect.any(Function),
      setUrlAccessPolicy: expect.any(Function),
    });
  });
});
