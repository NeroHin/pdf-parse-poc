import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type ResolvedOcrModels = {
  det: string;
  rec: string;
  dictText: string;
  docCls?: string;
  recFallback?: string;
  dictFallbackText?: string;
};

export type OcrModelProfile = "dev" | "quality";

function tryRead(p: string): string | null {
  try {
    if (existsSync(p)) return readFileSync(p, "utf8");
  } catch {
    /* ignore */
  }
  return null;
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function envPath(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? resolvePath(value) : undefined;
}

/**
 * Resolve ONNX + dictionary paths from `ESEARCH_OCR_MODEL_DIR` and optional overrides.
 * Returns null if the directory is missing or required files are absent.
 */
function defaultModelDir(profile: OcrModelProfile): string {
  return profile === "dev" ? "models/esearch-ocr-v5-mobile" : "models/esearch-ocr-v5";
}

export function resolveOcrModelsFromEnv(profile: OcrModelProfile = "quality"): ResolvedOcrModels | null {
  const configuredRoot = process.env.ESEARCH_OCR_MODEL_DIR?.trim() || defaultModelDir(profile);
  const root = configuredRoot ? resolvePath(configuredRoot) : "";
  if (!root || !existsSync(root)) {
    return null;
  }

  const det =
    envPath("ESEARCH_DET_ONNX") ??
    firstExisting([
      join(root, "PP-OCRv5_server_det_infer.onnx"),
      join(root, "ppocr_v5_server_det.onnx"),
      join(root, "ppocr_v5_mobile_det.onnx"),
      join(root, "ch_PP-OCRv2_det_infer.onnx"),
    ]);
  const rec =
    envPath("ESEARCH_REC_ONNX") ??
    firstExisting([
      join(root, "PP-OCRv5_server_rec_infer.onnx"),
      join(root, "ppocr_v5_server_rec.onnx"),
      join(root, "ppocr_v5_mobile_rec.onnx"),
      join(root, "ch_PP-OCRv2_rec_infer.onnx"),
    ]);
  const dictPath =
    envPath("ESEARCH_REC_DICT") ??
    firstExisting([
      join(root, "ppocrv5_dict.txt"),
      join(root, "ppocr_keys_v1.txt"),
      join(root, "chinese_cht_dict.txt"),
    ]) ??
    join(root, "ppocr_keys_v1.txt");

  const docCls = envPath("ESEARCH_DOC_CLS_ONNX") ?? join(root, "doc_ori.onnx");

  const recFb =
    envPath("ESEARCH_REC_FALLBACK_ONNX") ??
    join(root, "PP-OCRv4_server_rec_doc_infer.onnx");
  const dictFbPath =
    envPath("ESEARCH_REC_FALLBACK_DICT") ?? join(root, "ppocr_keys_v1.txt");

  const dictText = tryRead(dictPath);
  if (!dictText || !det || !rec || !existsSync(det) || !existsSync(rec)) {
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
