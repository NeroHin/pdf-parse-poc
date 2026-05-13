import type { BboxCoords } from "../types.js";

/**
 * Converts a PDF-points bbox (origin bottom-left) to normalized [0,1] coords
 * with origin top-left, suitable for CSS/canvas overlay.
 */
export function toNormalizedBbox(
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number
): BboxCoords {
  // PDF y is from bottom; flip for browser (top-left origin)
  const normX = x / pageWidth;
  const normY = (pageHeight - y - height) / pageHeight;
  const normW = width / pageWidth;
  const normH = height / pageHeight;

  return {
    x: Math.max(0, Math.min(1, normX)),
    y: Math.max(0, Math.min(1, normY)),
    width: Math.max(0, Math.min(1, normW)),
    height: Math.max(0, Math.min(1, normH)),
    coordinateSystem: "normalized",
  };
}

export function normalizeBboxIfNeeded(
  bbox: BboxCoords,
  pageWidth: number,
  pageHeight: number
): BboxCoords {
  if (bbox.coordinateSystem === "normalized") return bbox;
  return toNormalizedBbox(bbox.x, bbox.y, bbox.width, bbox.height, pageWidth, pageHeight);
}
