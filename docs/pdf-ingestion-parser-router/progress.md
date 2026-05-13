# PDF Ingestion Parser Router 進度紀錄

## 2026-05-13

### 已完成

- 建立 Fastify + Vue 3 + Element Plus + Vite PoC。
- 完成 PDF upload、local temp storage、in-memory preview store。
- 完成 OpenDataLoader dual-pass parser：
  - default pass
  - `useStructTree` pass
  - bbox key merge
  - text containment dedupe
- 後端 parser 已固定為 OpenDataLoader；不再提供 parser backend selector。
- Poppler 已安裝並驗證：
  - `/opt/homebrew/bin/pdfinfo`
  - `/opt/homebrew/bin/pdftoppm`
- 後端 preflight 改為 Poppler `pdfinfo`，取得 `pageCount` 與 `pageInfos`。
- 下載 eSearch-OCR 模型至 `models/esearch-ocr`：
  - `ch_PP-OCRv2_det_infer.onnx`
  - `ch_PP-OCRv2_rec_infer.onnx`
  - `ppocr_keys_v1.txt`
- 新增 OCR 環境腳本：
  - `npm run ocr:download-models`
  - `npm run ocr:check-env`
- 完成 eSearch-OCR page-level repair：
  - `scan_or_low_text`
  - `structural_hole`
  - Poppler raster
  - OCR blocks merge
  - `SourceBlock.provenance`
- 完成 OCR child-process worker：
  - `src/ingestion/ocr/ocrRepairWorker.ts`
  - `OCR_REPAIR_MAX_PAGES_IN_FLIGHT`
  - `OCR_REPAIR_USE_WORKER_POOL=false` debug fallback
- 新增 `OcrRepairAttempt` 結構化紀錄。
- 文件已收斂為 ODL-only + OCR repair scope。
- 新增 PP-OCRv5 server 模型支援與下載 script：
  - `npm run ocr:download-v5-models`
  - `models/esearch-ocr-v5/ppocr_v5_server_det.onnx`
  - `models/esearch-ocr-v5/ppocr_v5_server_rec.onnx`
  - `models/esearch-ocr-v5/ppocrv5_dict.txt`
- 新增 PP-OCRv5 mobile dev profile：
  - `npm run ocr:download-v5-mobile-models`
  - `OCR_MODEL_PROFILE=dev`
  - 預設 100 DPI、最多處理 2 個 OCR 觸發頁面
- OCR worker 改為 persistent worker protocol，避免每個 page job 都重新啟動 worker。

### 驗證結果

- `ESEARCH_OCR_MODEL_DIR=models/esearch-ocr npm run ocr:check-env` 通過。
- `ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5 npm run ocr:check-env` 通過。
- `ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5-mobile npm run ocr:check-env` 通過。
- dev profile smoke：`target.pdf` 約 16 秒，處理 page 6-7，產生 117 個 OCR blocks。
- quality profile smoke：限制 1 頁約 28 秒，處理 page 6，產生 32 個 OCR blocks。
- `npm run typecheck` 通過。

### 目前不做

- alternative backend parsers。
- parser backend selector。
- 規則產生工作流。
- durable DB persistence。

### 尚未完成

- 掃描 PDF fixture 的 OCR E2E 驗證。
- 正式 unit/integration test suite。
