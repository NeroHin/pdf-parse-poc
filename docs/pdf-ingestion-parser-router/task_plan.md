# PDF Ingestion Parser Router 任務計畫

## 目標

建立一個端到端 PDF parsing PoC：使用者上傳 PDF，後端固定使用 OpenDataLoader dual-pass 產生 `SourceBlock[]`，必要時以 eSearch-OCR 做 page-level repair；前端提供解析結果與原始 PDF bbox 對照 preview。

## 目前決策

- 後端 parser 固定為 OpenDataLoader dual-pass。
- 不再提供 alternative backend parser selector 或 Node 光柵備援。
- `pdfjs-dist` 僅保留在前端，用於瀏覽器 PDF canvas preview，不進入 ingestion/parser。
- OCR repair 是 OpenDataLoader 後的補洞層，不取代 ODL 主解析。
- 規則產生與草稿工作流目前不做，已移出本 PoC scope。
- 不導入 DB；原始 PDF 存本機暫存檔，preview document 存 process memory。

## Tech Stack

| 層級 | 技術 | 決策 |
|---|---|---|
| Runtime | Node.js `v20.20.2` | PoC baseline |
| Backend | Fastify | Upload API、原檔讀取 API、parser orchestration |
| Frontend | Vue.js 3 + Element Plus + Vite | 單頁 upload / preview UI |
| PDF page info | Poppler `pdfinfo` | 頁數與 page size |
| PDF 主解析 | OpenDataLoader `@opendataloader/pdf` + Java CLI | dual-pass merge |
| OCR repair | eSearch-OCR + `onnxruntime-node` | page-level repair |
| OCR raster | Poppler `pdftoppm` | 整頁 PNG raster |
| OCR worker | bounded child-process workers | `OCR_REPAIR_MAX_PAGES_IN_FLIGHT` 控制併發 |
| PDF viewer | `pdfjs-dist` browser renderer | 僅前端顯示與 bbox overlay |
| Storage | local temp files + in-memory Map | PoC scope |

## Pipeline

```text
PDF Upload
  -> save original PDF to tmp
  -> Poppler pdfinfo preflight (pageCount + page size)
  -> OpenDataLoader default pass + useStructTree pass
  -> dual-pass merge
  -> normalize to SourceBlock[]
  -> derive page stats from merged ODL items
  -> optional eSearch-OCR repair
      -> compute repair triggers
      -> bounded OCR child-process workers
      -> Poppler pdftoppm raster
      -> eSearch OCR
      -> merge ODL + OCR blocks
  -> dedupe
  -> quality report
  -> build PdfPreviewDocument
  -> two-pane preview
```

## OCR Repair

### 已完成

- Poppler `pdfinfo` / `pdftoppm` 整合。
- eSearch-OCR 模型下載目錄：`models/esearch-ocr`。
- `ESEARCH_OCR_MODEL_DIR` 支援 PP-OCRv5 檔名與已下載的 eSearch-OCR 3.0.0 PP-OCRv2 檔名。
- Trigger：`scan_or_low_text`、`structural_hole`。
- `SourceBlock.provenance` 含 `raster`、`fallbackReasons`、`ocrAttempts`、`repairTriggers`。
- OCR child-process worker：`src/ingestion/ocr/ocrRepairWorker.ts`。
- 併發控制：`OCR_REPAIR_MAX_PAGES_IN_FLIGHT`，預設 `2`。
- 可用 `OCR_REPAIR_USE_WORKER_POOL=false` 退回同進程 OCR，便於 debugging。

### 環境變數

| 變數 | 用途 |
|---|---|
| `ESEARCH_OCR_MODEL_DIR` | OCR 模型目錄；預設可用 `models/esearch-ocr` |
| `PDFINFO_PATH` | 覆寫 `pdfinfo` binary path |
| `PDFTOPPM_PATH` | 覆寫 `pdftoppm` binary path |
| `OCR_REPAIR_MAX_PAGES_IN_FLIGHT` | OCR page worker 併發數，預設 `2` |
| `OCR_REPAIR_USE_WORKER_POOL` | `false` 時停用 worker 子進程 |
| `OCR_REPAIR_PERSISTENT_WORKERS` | `false` 時停用常駐 worker pool |
| `OCR_MODEL_PROFILE` | `dev` 或 `quality` |
| `OCR_REPAIR_MAX_PAGES` | 限制 OCR repair 頁數 |
| `OCR_RASTER_DPI_PRIMARY` | 第一輪 raster DPI，預設 `150` |
| `OCR_RASTER_DPI_FALLBACK` | fallback raster DPI，預設 `220` |

### 驗證指令

```bash
npm run ocr:download-models
ESEARCH_OCR_MODEL_DIR=models/esearch-ocr npm run ocr:check-env
npm run ocr:download-v5-models
ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5 npm run ocr:check-env
npm run ocr:download-v5-mobile-models
ESEARCH_OCR_MODEL_DIR=models/esearch-ocr-v5-mobile npm run ocr:check-env
npm run typecheck
npm run build
```

## 資料模型重點

```ts
type SourceBlock = {
  id: string;
  documentId: string;
  page: number;
  blockType: "heading" | "paragraph" | "table" | "list" | "footer" | "header" | "image_ocr" | "unknown";
  text: string;
  bbox: { x: number; y: number; width: number; height: number; coordinateSystem: "pdf-points" | "normalized" };
  parser: "opendataloader-default" | "opendataloader-hybrid" | "opendataloader-safety" | "esearch-ocr-repair";
  parserVersion: string;
  extractionMode: "native_text" | "ocr" | "hybrid" | "safety";
  confidence: number;
  warnings: string[];
  sourceHash: string;
  provenance?: {
    parserId: string;
    modelLabel?: string;
    raster?: { engine: "poppler"; dpi: number; widthPx: number; heightPx: number; pagePtsWidth: number; pagePtsHeight: number };
    fallbackReasons?: string[];
    ocrAttempts?: OcrRepairAttempt[];
    repairTriggers?: ("scan_or_low_text" | "structural_hole")[];
  };
};
```

## 階段狀態

| 階段 | 狀態 | 說明 |
|---|---|---|
| P0 Upload / preview loop | complete | Fastify upload、memory preview store、Vue two-pane preview |
| P0 ODL dual-pass parser | complete | default + useStructTree merge |
| P0 Poppler preflight | complete | 取代 backend pdf.js preflight |
| P1 OCR model / Poppler env | complete | Homebrew Poppler 可用；模型下載至 `models/esearch-ocr` |
| P1 OCR repair | complete | page trigger、raster、OCR、merge、provenance |
| P1 OCR worker | complete | bounded child-process workers |
| P1 OCR dev/quality profile | complete | dev: v5 mobile + 100 DPI + 2 pages；quality: v5 server + 150 DPI |
| P1 自動化測試 | pending | 尚未有正式 unit/integration test suite |
| P1 掃描 PDF E2E | pending | 需補掃描 fixture 驗證 OCR blocks |

## 完成定義

- 上傳 `data/target.pdf` 可回傳 `PdfPreviewDocument`。
- 後端不再依賴 alternative PDF text parser。
- 所有 parser output 都統一為 `SourceBlock[]`。
- ODL blocks 可在前端對照原始 PDF bbox。
- OCR repair 啟用時可產生 `esearch-ocr-repair` blocks，並保留 worker attempt provenance。
- 規則產生與草稿工作流不屬於目前完成定義。
