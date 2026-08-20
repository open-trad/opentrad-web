function comparableText(value) {
  return value.normalize("NFKC").replace(/\s+/gu, "");
}

function describeSequence(values) {
  return values.join(" -> ");
}

function orientationRuns(values) {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

export function assertManifestMatrix(templates, registrations) {
  if (!Array.isArray(templates) || templates.length !== 15) {
    throw new Error("Manifest must contain exactly 15 templates");
  }
  const ids = templates.map((template) => template.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Manifest contains duplicate template ids");
  }
  const actual = templates.map((template) => `${template.id}@${template.version}`).sort();
  const expected = registrations
    .map((registration) => `${registration.id}@${registration.version}`)
    .sort();
  if (expected.length !== 15 || actual.some((value, index) => value !== expected[index])) {
    throw new Error("Manifest registrations do not match the launch template registry");
  }
}

export function assertSemanticDigestText(digest, renderedText, label) {
  const haystack = comparableText(renderedText);
  const missingLines = digest
    .split("\n")
    .map(comparableText)
    .filter((line) => line.length > 0 && !haystack.includes(line));
  if (missingLines.length > 0) {
    throw new Error(`${label} is missing semantic text: ${missingLines.slice(0, 3).join(" | ")}`);
  }
}

export function collectStaticText(value) {
  const values = [];
  const visit = (candidate) => {
    if (typeof candidate === "string") {
      values.push(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const item of Object.values(candidate)) visit(item);
    }
  };
  visit(value);
  return values.join("\n");
}

export function assertExactOrientations(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label} orientation sequence ${describeSequence(actual)} does not match ${describeSequence(expected)}`,
    );
  }
}

export function assertOrientationRuns(actual, expected, label) {
  const actualRuns = orientationRuns(actual);
  const expectedRuns = orientationRuns(expected);
  if (
    actualRuns.length !== expectedRuns.length ||
    actualRuns.some((value, index) => value !== expectedRuns[index])
  ) {
    throw new Error(
      `${label} orientation runs ${describeSequence(actualRuns)} do not match ${describeSequence(expectedRuns)}`,
    );
  }
}
