#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const targetDir = resolve(process.argv[2] ?? "models/esearch-ocr");
const variant = process.env.OCR_MODEL_VARIANT ?? "v2";

const modelSets = {
  v2: [
  {
    name: "ch_PP-OCRv2_det_infer.onnx",
    url: "https://sourceforge.net/projects/e-search-ocr/files/3.0.0/ch_PP-OCRv2_det_infer.onnx/download",
  },
  {
    name: "ch_PP-OCRv2_rec_infer.onnx",
    url: "https://sourceforge.net/projects/e-search-ocr/files/3.0.0/ch_PP-OCRv2_rec_infer.onnx/download",
  },
  {
    name: "ppocr_keys_v1.txt",
    url: "https://sourceforge.net/projects/e-search-ocr/files/3.0.0/ppocr_keys_v1.txt/download",
  },
  ],
  "v5-server": [
    {
      name: "ppocr_v5_server.zip",
      url: "https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v5_server.zip",
      unzip: true,
    },
  ],
  "v5-mobile": [
    {
      name: "ppocr_v5_mobile.zip",
      url: "https://github.com/xushengfeng/eSearch-OCR/releases/download/4.0.0/ppocr_v5_mobile.zip",
      unzip: true,
    },
  ],
};

const files = modelSets[variant];
if (!files) {
  throw new Error(`Unknown OCR_MODEL_VARIANT=${variant}; expected one of ${Object.keys(modelSets).join(", ")}`);
}

async function download(url, outputPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${url}`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  await pipeline(response.body, createWriteStream(outputPath));
}

async function unzip(zipPath, outputDir) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("unzip", ["-o", zipPath, "-d", outputDir], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `unzip failed: ${zipPath}`);
  }
}

mkdirSync(targetDir, { recursive: true });

for (const file of files) {
  const outputPath = resolve(targetDir, file.name);
  if (existsSync(outputPath)) {
    console.log(`skip ${outputPath}`);
  } else {
    console.log(`download ${file.name}`);
    await download(file.url, outputPath);
  }
  if (file.unzip) {
    await unzip(outputPath, targetDir);
  }
}

console.log(`ESEARCH_OCR_MODEL_DIR=${targetDir}`);
