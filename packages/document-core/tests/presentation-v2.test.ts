import { describe, expect, it } from "vitest";
import {
  getPresentationProfile,
  PRESENTATION_PROFILES,
  type PresentationProfileV1,
} from "../src/v2/index";

const PROFILE_IDS = [
  "classic-formal.v1",
  "modern-business.v1",
  "international-compact.v1",
] as const;

function assertReadonlyPublicType(profile: PresentationProfileV1): void {
  // @ts-expect-error Presentation profile properties are public readonly values.
  profile.label = "已修改";
  // @ts-expect-error Nested color tokens are public readonly values.
  profile.colors.ink = "#000000";
  // @ts-expect-error Default document kinds are exposed as a readonly array.
  profile.defaultDocumentKinds.push("quotation");
}
void assertReadonlyPublicType;

describe("presentation profiles", () => {
  it("ships exactly three profiles in deterministic key order", () => {
    expect(Object.keys(PRESENTATION_PROFILES)).toEqual(PROFILE_IDS);
    expect(Object.keys(getPresentationProfile("classic-formal.v1"))).toEqual([
      "id",
      "label",
      "defaultDocumentKinds",
      "colors",
      "typography",
      "spacing",
      "table",
    ]);
  });

  it("publishes the exact classic formal tokens", () => {
    expect(getPresentationProfile("classic-formal.v1")).toEqual({
      id: "classic-formal.v1",
      label: "经典正式",
      defaultDocumentKinds: ["contract", "bid"],
      colors: {
        ink: "#17201E",
        accent: "#203A35",
        muted: "#5E6965",
        paper: "#FFFFFF",
        rule: "#9AA5A0",
      },
      typography: { bodyPt: 10.5, smallPt: 8, titlePt: 20, headingPt: 13 },
      spacing: { blockAfterPt: 8, paragraphAfterPt: 5, cellPaddingPt: 4 },
      table: { headerFill: "#E6EBE8", headerText: "#17201E", striped: false },
    });
  });

  it("publishes the exact modern business tokens", () => {
    expect(getPresentationProfile("modern-business.v1")).toEqual({
      id: "modern-business.v1",
      label: "现代商务",
      defaultDocumentKinds: ["quotation"],
      colors: {
        ink: "#20312E",
        accent: "#285B50",
        muted: "#68726E",
        paper: "#FDFBF5",
        rule: "#B9C7C0",
      },
      typography: { bodyPt: 10, smallPt: 8, titlePt: 21, headingPt: 13 },
      spacing: { blockAfterPt: 9, paragraphAfterPt: 5, cellPaddingPt: 5 },
      table: { headerFill: "#285B50", headerText: "#FFFFFF", striped: true },
    });
  });

  it("publishes the exact international compact tokens", () => {
    expect(getPresentationProfile("international-compact.v1")).toEqual({
      id: "international-compact.v1",
      label: "国际简洁",
      defaultDocumentKinds: ["quotation", "contract"],
      colors: {
        ink: "#16272F",
        accent: "#235B6A",
        muted: "#65747A",
        paper: "#FFFFFF",
        rule: "#AAB8BD",
      },
      typography: { bodyPt: 9, smallPt: 7.5, titlePt: 18, headingPt: 11.5 },
      spacing: { blockAfterPt: 7, paragraphAfterPt: 4, cellPaddingPt: 3 },
      table: { headerFill: "#DDE9EC", headerText: "#16272F", striped: false },
    });
  });

  it("deep-freezes the registry, profiles, arrays and nested token groups", () => {
    expect(Object.isFrozen(PRESENTATION_PROFILES)).toBe(true);
    for (const id of PROFILE_IDS) {
      const profile = PRESENTATION_PROFILES[id];
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.defaultDocumentKinds)).toBe(true);
      expect(Object.isFrozen(profile.colors)).toBe(true);
      expect(Object.isFrozen(profile.typography)).toBe(true);
      expect(Object.isFrozen(profile.spacing)).toBe(true);
      expect(Object.isFrozen(profile.table)).toBe(true);
    }
  });

  it("does not let callers mutate nested tokens or document-kind arrays", () => {
    const profile = getPresentationProfile("classic-formal.v1");
    const colors = profile.colors as { ink: string };
    const kinds = profile.defaultDocumentKinds as Array<"quotation" | "contract" | "bid">;

    expect(() => {
      colors.ink = "#000000";
    }).toThrow(TypeError);
    expect(() => kinds.push("quotation")).toThrow(TypeError);
    expect(profile.colors.ink).toBe("#17201E");
    expect(profile.defaultDocumentKinds).toEqual(["contract", "bid"]);
  });

  it("returns the stable frozen registry identity for each known profile", () => {
    for (const id of PROFILE_IDS) {
      expect(getPresentationProfile(id)).toBe(PRESENTATION_PROFILES[id]);
      expect(getPresentationProfile(id)).toBe(getPresentationProfile(id));
    }
  });

  it("rejects unknown and prototype-hostile lookup keys with a finite Chinese error", () => {
    for (const key of ["unknown.v1", "__proto__", "constructor", "prototype", "toString"]) {
      let caught: unknown;
      try {
        getPresentationProfile(key);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("不支持的版式");
      expect((caught as Error).message.length).toBeLessThanOrEqual(20);
      expect((caught as Error).message).not.toContain(key);
    }
  });
});
