import type { LayoutStyleId } from "./common.js";

export type PresentationDocumentKindV1 = "quotation" | "contract" | "bid";

export interface PresentationColorsV1 {
  readonly ink: string;
  readonly accent: string;
  readonly muted: string;
  readonly paper: string;
  readonly rule: string;
}

export interface PresentationTypographyV1 {
  readonly bodyPt: number;
  readonly smallPt: number;
  readonly titlePt: number;
  readonly headingPt: number;
}

export interface PresentationSpacingV1 {
  readonly blockAfterPt: number;
  readonly paragraphAfterPt: number;
  readonly cellPaddingPt: number;
}

export interface PresentationTableV1 {
  readonly headerFill: string;
  readonly headerText: string;
  readonly striped: boolean;
}

export interface PresentationProfileV1 {
  readonly id: LayoutStyleId;
  readonly label: string;
  readonly defaultDocumentKinds: readonly PresentationDocumentKindV1[];
  readonly colors: PresentationColorsV1;
  readonly typography: PresentationTypographyV1;
  readonly spacing: PresentationSpacingV1;
  readonly table: PresentationTableV1;
}

function createPresentationProfile(profile: PresentationProfileV1): PresentationProfileV1 {
  return Object.freeze({
    id: profile.id,
    label: profile.label,
    defaultDocumentKinds: Object.freeze([...profile.defaultDocumentKinds]),
    colors: Object.freeze({ ...profile.colors }),
    typography: Object.freeze({ ...profile.typography }),
    spacing: Object.freeze({ ...profile.spacing }),
    table: Object.freeze({ ...profile.table }),
  });
}

export const PRESENTATION_PROFILES = Object.freeze({
  "classic-formal.v1": createPresentationProfile({
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
  }),
  "modern-business.v1": createPresentationProfile({
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
  }),
  "international-compact.v1": createPresentationProfile({
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
  }),
} satisfies Record<LayoutStyleId, PresentationProfileV1>);

export function getPresentationProfile(layoutStyleId: string): PresentationProfileV1 {
  if (!Object.hasOwn(PRESENTATION_PROFILES, layoutStyleId)) {
    throw new Error("不支持的版式");
  }
  return PRESENTATION_PROFILES[layoutStyleId as LayoutStyleId];
}
