import type { SourceBlock, BboxCoords } from "../types.js";

function bboxOverlapRatio(a: BboxCoords, b: BboxCoords): number {
  if (a.coordinateSystem !== b.coordinateSystem) return 0;

  const xOverlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );
  const intersectionArea = xOverlap * yOverlap;

  if (intersectionArea === 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const unionArea = aArea + bArea - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

export function dedupeBlocks(
  blocks: SourceBlock[],
  options: { bboxOverlapThreshold?: number } = {}
): SourceBlock[] {
  const { bboxOverlapThreshold = 0.85 } = options;
  const kept: SourceBlock[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const key = `${block.page}:${block.sourceHash}`;
    if (seen.has(key)) continue;

    const hasBboxOverlap = kept.some(
      (k) =>
        k.page === block.page &&
        bboxOverlapRatio(k.bbox, block.bbox) >= bboxOverlapThreshold
    );

    if (hasBboxOverlap) continue;

    seen.add(key);
    kept.push(block);
  }

  return kept;
}
