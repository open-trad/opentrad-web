import { describe, expect, it } from "vitest";
import { allocateComplianceMatrixWidthsTwips, allocatePercentageWidthsTwips } from "./tableWidths";

describe("exact DOCX table widths", () => {
  it("allocates an exact 100% declaration and lets the final column absorb rounding", () => {
    const widths = allocatePercentageWidthsTwips(["33.33%", "33.33%", "33.34%"], 10_001);

    expect(widths).toEqual([3_333, 3_333, 3_335]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(10_001);
  });

  it.each([["99.999%", "0.0009%"], ["100.0001%"], ["1e2%"], ["100 %"], ["0%", "100%"]])(
    "rejects invalid or non-exact percentages without a floating tolerance",
    (...widths) => {
      expect(() => allocatePercentageWidthsTwips(widths, 10_000)).toThrow(
        "表格列宽必须为正数且精确合计 100%",
      );
    },
  );

  it("reserves 15% and 20% for compliance metadata and scales declared columns to 65%", () => {
    const widths = allocateComplianceMatrixWidthsTwips(["40%", "60%"], 10_001);

    expect(widths).toEqual([1_500, 2_000, 2_600, 3_901]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(10_001);
  });

  it("validates compliance declaration percentages before scaling", () => {
    expect(() => allocateComplianceMatrixWidthsTwips(["50%", "49.9999%"], 10_000)).toThrow(
      "表格列宽必须为正数且精确合计 100%",
    );
  });
});
