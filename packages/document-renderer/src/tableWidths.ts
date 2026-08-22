const PERCENTAGE_PATTERN = /^(\d{1,3})(?:\.(\d+))?%$/u;
const WIDTH_ERROR = "表格列宽必须为正数且精确合计 100%";

interface ExactPercentage {
  readonly numerator: bigint;
  readonly scale: number;
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function parseExactPercentage(value: string): ExactPercentage {
  const match = PERCENTAGE_PATTERN.exec(value);
  if (!match) throw new Error(WIDTH_ERROR);
  const whole = match[1];
  const decimal = match[2] ?? "";
  if (whole === undefined) throw new Error(WIDTH_ERROR);
  const scale = decimal.length;
  const denominator = powerOfTen(scale);
  const numerator = BigInt(`${whole}${decimal}`);
  if (numerator <= 0n || numerator > 100n * denominator) {
    throw new Error(WIDTH_ERROR);
  }
  return { numerator, scale };
}

function validateExactTotal(values: readonly string[]): readonly ExactPercentage[] {
  if (values.length === 0) throw new Error(WIDTH_ERROR);
  const percentages = values.map(parseExactPercentage);
  const commonScale = Math.max(...percentages.map((percentage) => percentage.scale));
  const commonDenominator = powerOfTen(commonScale);
  const total = percentages.reduce(
    (sum, percentage) => sum + percentage.numerator * powerOfTen(commonScale - percentage.scale),
    0n,
  );
  if (total !== 100n * commonDenominator) throw new Error(WIDTH_ERROR);
  return percentages;
}

function roundPercentageOfTwips(availableTwips: number, percentage: ExactPercentage): number {
  const denominator = 100n * powerOfTen(percentage.scale);
  const numerator = BigInt(availableTwips) * percentage.numerator;
  return Number((numerator + denominator / 2n) / denominator);
}

function validateAvailableTwips(availableTwips: number): void {
  if (!Number.isSafeInteger(availableTwips) || availableTwips <= 0) {
    throw new Error("表格可用宽度无效");
  }
}

export function allocatePercentageWidthsTwips(
  values: readonly string[],
  availableTwips: number,
): readonly number[] {
  validateAvailableTwips(availableTwips);
  const percentages = validateExactTotal(values);
  let allocated = 0;
  const widths = percentages.map((percentage, index) => {
    const width =
      index === percentages.length - 1
        ? availableTwips - allocated
        : roundPercentageOfTwips(availableTwips, percentage);
    if (width <= 0) throw new Error(WIDTH_ERROR);
    allocated += width;
    return width;
  });
  return Object.freeze(widths);
}

export function allocateComplianceMatrixWidthsTwips(
  declaredValues: readonly string[],
  availableTwips: number,
): readonly number[] {
  validateAvailableTwips(availableTwips);
  validateExactTotal(declaredValues);
  const sourceReferenceWidth = Math.round(availableTwips * 0.15);
  const requirementTypeWidth = Math.round(availableTwips * 0.2);
  const declaredWidth = availableTwips - sourceReferenceWidth - requirementTypeWidth;
  const declaredWidths = allocatePercentageWidthsTwips(declaredValues, declaredWidth);
  return Object.freeze([sourceReferenceWidth, requirementTypeWidth, ...declaredWidths]);
}
