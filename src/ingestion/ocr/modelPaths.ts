import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ResolvedOcrModels = {
  det: string;
  rec: string;
  dictText: string;
  docCls?: string;
  recFallback?: string;
  dictFallbackText?: string;
};

function tryRead(p: string): string | null {
  try {
    if (existsSync(p)) return readFileSync(p, "utf8");
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve ONNX + dictionary paths from `ESEARCH_OCR_MODEL_DIR` and optional overrides.
 * Returns null if the directory is missing or required files are absent.
 */
export function resolveOcrModelsFromEnv(): ResolvedOcrModels | null {
  const root = process.env.ESEARCH_OCR_MODEL_DIR?.trim();
  if (!root || !existsSync(root)) {
    return null;
  }

  const det =
    process.env.ESEARCH_DET_ONNX?.trim() ??
    join(root, "PP-OCRv5_server_det_infer.onnx");
  const rec =
    process.env.ESEARCH_REC_ONNX?.trim() ??
    join(root, "PP-OCRv5_server_rec_infer.onnx");
  const dictPath =
    process.env.ESEARCH_REC_DICT?.trim() ??
    join(root, "ppocr_keys_v1.txt");

  const docCls = process.env.ESEARCH_DOC_CLS_ONNX?.trim() ?? join(root, "doc_ori.onnx");

  const recFb =
    process.env.ESEARCH_REC_FALLBACK_ONNX?.trim() ??
    join(root, "PP-OCRv4_server_rec_doc_infer.onnx");
  const dictFbPath =
    process.env.ESEARCH_REC_FALLBACK_DICT?.trim() ?? join(root, "ppocr_keys_v1.txt");

  const dictText = tryRead(dictPath);
  if (!dictText || !existsSync(det) || !existsSync(rec)) {
    return null;
  }

  const docClsFinal = existsSync(docCls) ? docCls : undefined;
  const recFbFinal = existsSync(recFb) ? recFb : undefined;

  let dictFallbackText: string | undefined;
  if (recFbFinal) {
    if (dictFbPath !== dictPath) {
      dictFallbackText = tryRead(dictFbPath) ?? dictText;
    } else {
      dictFallbackText = dictText;
    }
  }

  return {
    det,
    rec,
    dictText,
    docCls: docClsFinal,
    recFallback: recFbFinal,
    dictFallbackText,
  };
}
