const FALLBACK_BASENAME = "OpenTrad-报价单";
const WINDOWS_INVALID = /[\\/:*?"<>|]+/gu;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export type DownloadExtension = "docx" | "json" | "opentrad" | "pdf";

function stripControlAndBidi(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) {
        return false;
      }
      return !(
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    })
    .join("");
}

export function sanitizeDownloadBasename(input: string): string {
  const normalized = stripControlAndBidi(input.normalize("NFKC"))
    .replace(WINDOWS_INVALID, "-")
    .replace(/\s+/gu, " ")
    .replace(/^[.\s-]+|[.\s-]+$/gu, "");
  const limited = Array.from(normalized)
    .slice(0, 80)
    .join("")
    .replace(/[.\s-]+$/gu, "");
  if (!limited || WINDOWS_RESERVED.test(limited)) {
    return FALLBACK_BASENAME;
  }
  return limited;
}

export function buildDownloadFilename(input: string, extension: DownloadExtension): string {
  return `${sanitizeDownloadBasename(input)}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  let objectUrl: string | undefined;
  const anchor = document.createElement("a");
  try {
    objectUrl = URL.createObjectURL(blob);
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
  } catch {
    throw new Error("文件下载失败，请重试");
  } finally {
    anchor.remove();
    if (objectUrl) {
      const urlToRevoke = objectUrl;
      setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1_000);
    }
  }
}
