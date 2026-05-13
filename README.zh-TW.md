# PDF Parse PoC

[English](README.md)

以 OpenDataLoader 為主的 PDF ingestion PoC，支援選擇性 eSearch-OCR v5 修補與 Vue 預覽/匯出 UI。

## 個人筆記

實驗的限制是為了測試 NodeJS 的 Lib 中有沒有 Production 的 PDF2Text 的工具；而實驗結論是：目前沒有；比較理想的都是混合式的方法。
以下是小結：
1. 純 CPU 目前如果是標準的 PDF（Word2PDF、列印的 PDF）用 OpenDataLoader；但最大問題是遇到掃不出來的就要用 Mix Mode（Docling Server）
2. 在取捨下原本想用 PaddleOCR CLI / Service 來完成，但想到有 Python 相依性就放棄
3. 後面是找到 Search-OCR 作為 NodeJS OCR 的實現、後面也是用 PaddleOCR v5 Model
4. 但純 CPU 環境下只能用 mobile model、full model 會偏慢；而且 coreML 加速會有問題

結論：
1. 最好還是把 OCR 單獨部署成服務，在 scaling 上才不會有限制
2. PaddleOCR v5 很好很強、但還沒用過 VLM 來比較

## 特色

- 後端 parser 固定使用 OpenDataLoader。
- `pdfjs-dist` 只用於瀏覽器 PDF preview。
- 可選擇用 eSearch-OCR v5 修補掃描、低文字、結構洞與表格頁。
- Poppler `pdfinfo` / `pdftoppm` 用於 preflight 與 OCR rasterization。
- OCR worker pool 支援併發限制與 persistent model loading。
- OCR 後處理：
  - 左右欄法規/表格重組，
  - OpenCC `s2tw.json`，
  - 空白與標點修正。
- Vue UI：
  - 上傳與解析選項，
  - OCR profile 與頁數限制，
  - PDF preview 與 focused highlight，
  - 每頁 copy，
  - 匯出所有文字，
  - 下載 `.txt`。

## UI

- OCR mode

  ![](img/ui-ocr.png)

- ODL mode

  ![](img/ui-odl.png)

## Pipeline

```text
PDF upload
  -> Poppler preflight
  -> OpenDataLoader dual-pass parse
  -> SourceBlock normalization
  -> optional OCR repair
  -> layout/text cleanup
  -> preview and text export
```

## 系統需求

- Node.js `>=20.20.0 <21`
- Java 11+
- Poppler `pdfinfo` 與 `pdftoppm`
- eSearch-OCR v5 model files

## 安裝

```bash
npm install
npm run ocr:download-v5-mobile-models
ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5-mobile OCR_MODEL_PROFILE=dev npm run ocr:check-env
```

若要較大的 v5 server model：

```bash
npm run ocr:download-v5-models
ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5 OCR_MODEL_PROFILE=quality npm run ocr:check-env
```

`npm run ocr:download-models` 仍保留給 legacy PP-OCRv2 assets，但目前流程應使用 v5，因為 v2 與 v5 的輸出不同。

## 執行

```bash
ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5-mobile \
OCR_MODEL_PROFILE=dev \
OCR_REPAIR_MAX_PAGES_IN_FLIGHT=1 \
npm run dev
```

開啟 `http://localhost:5173` 上傳 PDF。UI 的 OCR 頁數限制 `0` 表示不限制。

## Scripts

| Script | 用途 |
|---|---|
| `npm run dev` | 啟動 Fastify 與 Vite |
| `npm run dev:server` | 只啟動 Fastify |
| `npm run dev:web` | 只啟動 Vite |
| `npm run typecheck` | TypeScript 檢查 |
| `npm run build` | 前端 production build |
| `npm run ocr:download-v5-mobile-models` | 下載 v5 mobile model |
| `npm run ocr:download-v5-models` | 下載 v5 server model |
| `npm run ocr:check-env` | 檢查 OCR models 與 Poppler |

## 主要 OCR 環境變數

| 變數 | 用途 |
|---|---|
| `ESEARCH_OCR_MODEL_DIR` | OCR model directory |
| `OCR_MODEL_PROFILE` | `dev` 或 `quality` |
| `OCR_REPAIR_MAX_PAGES` | OCR 最大頁數；`0` 表示不限制 |
| `OCR_REPAIR_MAX_PAGES_IN_FLIGHT` | OCR page 併發數 |
| `OCR_REPAIR_USE_WORKER_POOL` | 使用 child-process OCR workers |
| `OCR_REPAIR_PERSISTENT_WORKERS` | worker 跨頁保留 |
| `PDFINFO_PATH` / `PDFTOPPM_PATH` | 覆寫 Poppler binaries |

## API

### `POST /api/pdf/parse`

Multipart fields：

- `file`：PDF file
- `parseMode`：`auto | native_text | scanned_image | mixed_or_unknown`
- `advancedOptions`：JSON string

範例：

```json
{
  "enableComplexTableParsing": true,
  "enableOcrRepair": true,
  "ocrRepairProfile": "dev",
  "maxOcrPages": 0,
  "repairOnScanOrLowText": true,
  "repairOnStructuralHole": true
}
```

### `GET /api/pdf/:documentId/original`

串流回傳上傳的 PDF，供 preview 使用。

## 範圍

已包含：ODL parsing、Poppler preflight/raster、eSearch-OCR v5 repair、OCR layout/text cleanup、SourceBlock provenance、Vue preview、文字 copy/export。

未包含：backend pdf.js parser、parser selector、rule candidate extraction、durable DB persistence、精準 spreadsheet-like table modeling。
