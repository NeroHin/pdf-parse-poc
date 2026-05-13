import type { BboxCoords } from "../types.js";
import { toNormalizedBbox } from "../normalize/bbox.js";

export type Quad = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * Map esearch-OCR box (pixel coords, top-left origin, y down) to normalized bbox.
 */
export function quadToNormalizedBbox(
  box: Quad,
  rasterW: number,
  rasterH: number,
  pageWpts: number,
  pageHpts: number
): BboxCoords {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  const leftPx = Math.min(...xs);
  const rightPx = Math.max(...xs);
  const topPx = Math.min(...ys);
  const bottomPx = Math.max(...ys);

  const pdfLeft = (leftPx / rasterW) * pageWpts;
  const pdfRight = (rightPx / rasterW) * pageWpts;
  const pdfTop = pageHpts - (topPx / rasterH) * pageHpts;
  const pdfBottom = pageHpts - (bottomPx / rasterH) * pageHpts;

  const width = pdfRight - pdfLeft;
  const height = pdfTop - pdfBottom;

  return toNormalizedBbox(pdfLeft, pdfBottom, width, height, pageWpts, pageHpts);
}
