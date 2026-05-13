#!/usr/bin/env node
import { accessSync, constants, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function resolveBinary(envName, binaryName) {
  const configured = process.env[envName];
  if (configured) return configured;
  const homebrewPath = `/opt/homebrew/bin/${binaryName}`;
  if (existsSync(homebrewPath)) return homebrewPath;
  return binaryName;
}

function checkExecutable(label, path, args) {
  const result = spawnSync(path, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} unavailable: ${result.error?.message ?? result.stderr}`);
  }
  console.log(`${label}: ok`);
}

const modelDir = resolve(process.env.ESEARCH_OCR_MODEL_DIR ?? "models/esearch-ocr");
const required = [
  existsSync(join(modelDir, "ppocrv5_dict.txt"))
    ? "ppocrv5_dict.txt"
    : existsSync(join(modelDir, "chinese_cht_dict.txt"))
      ? "chinese_cht_dict.txt"
      : "ppocr_keys_v1.txt",
  existsSync(join(modelDir, "PP-OCRv5_server_det_infer.onnx"))
    ? "PP-OCRv5_server_det_infer.onnx"
    : existsSync(join(modelDir, "ppocr_v5_server_det.onnx"))
      ? "ppocr_v5_server_det.onnx"
      : existsSync(join(modelDir, "ppocr_v5_mobile_det.onnx"))
        ? "ppocr_v5_mobile_det.onnx"
        : "ch_PP-OCRv2_det_infer.onnx",
  existsSync(join(modelDir, "PP-OCRv5_server_rec_infer.onnx"))
    ? "PP-OCRv5_server_rec_infer.onnx"
    : existsSync(join(modelDir, "ppocr_v5_server_rec.onnx"))
      ? "ppocr_v5_server_rec.onnx"
      : existsSync(join(modelDir, "ppocr_v5_mobile_rec.onnx"))
        ? "ppocr_v5_mobile_rec.onnx"
        : existsSync(join(modelDir, "chinese_cht_rec.onnx"))
          ? "chinese_cht_rec.onnx"
          : "ch_PP-OCRv2_rec_infer.onnx",
];

for (const name of required) {
  const path = join(modelDir, name);
  accessSync(path, constants.R_OK);
  console.log(`model: ${path}`);
}

checkExecutable("pdfinfo", resolveBinary("PDFINFO_PATH", "pdfinfo"), ["-v"]);
checkExecutable("pdftoppm", resolveBinary("PDFTOPPM_PATH", "pdftoppm"), ["-v"]);
console.log(`ESEARCH_OCR_MODEL_DIR=${modelDir}`);
