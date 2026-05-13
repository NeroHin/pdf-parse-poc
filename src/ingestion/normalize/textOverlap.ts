/**
 * Text overlap helpers for deduplicating blocks across ODL passes and OCR repair.
 */

export function collapseWs(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

export function overlapRatio(
  normNew: string,
  normExisting: string,
  windowSize = 8
): number {
  if (normNew.length < windowSize) {
    return normExisting.includes(normNew) ? 1 : 0;
  }
  const total = normNew.length - windowSize + 1;
  let hits = 0;
  for (let i = 0; i < total; i++) {
    if (normExisting.includes(normNew.slice(i, i + windowSize))) hits++;
  }
  return hits / total;
}

export function hasSubstantialOverlap(
  normNew: string,
  existingTexts: string[],
  threshold = 0.5
): boolean {
  for (const existing of existingTexts) {
    if (overlapRatio(normNew, existing) >= threshold) return true;
  }
  return false;
}
