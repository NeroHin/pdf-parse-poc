import type { SourceBlock } from "../types.js";

/**
 * OpenDataLoader adapter placeholder.
 * P1 will implement actual OCR/hybrid/safety routing.
 * Currently returns an empty block list with a warning.
 */
export function runOpendataloaderAdapter(
  _filePath: string,
  targetPages: number[],
  documentId: string,
  mode: "default" | "hybrid" | "safety"
): SourceBlock[] {
  // Placeholder: return no blocks to signal not yet implemented
  void _filePath;
  void targetPages;
  void documentId;
  void mode;
  return [];
}

export function opendataloaderWarning(
  targetPages: number[],
  mode: string
): string {
  return `第 ${targetPages.join(", ")} 頁建議使用 OpenDataLoader (${mode}) 解析，目前 adapter 尚未接入，該頁面 blocks 可能不完整。`;
}
