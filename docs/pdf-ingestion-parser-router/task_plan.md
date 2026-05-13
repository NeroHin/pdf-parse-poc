# PDF Ingestion Parser Router 任務計畫

## 目標

建立一個簡單但端到端可操作的 PDF parsing PoC。使用者可在單一頁面上傳 PDF、指定或保留自動解析模式；後端完成 preflight detection、parser routing 與 `SourceBlock[]` normalization；前端提供左右雙欄 preview，左側顯示 parsing 結果，右側顯示原始 PDF，點選任一 parsing 區塊時能在原檔中定位並 highlight 對應 bbox。PoC 先證明 upload -> parse -> block preview -> source mapping 的核心體驗，再擴充 rule candidate extraction。

## 原則

- 使用者選項只能影響 routing preference，不能覆蓋 system detection 與 quality fallback。
- 偵測與路由以 page-level 為基本單位，不以整份文件單一分類決定。
- 上層 rule extraction 不直接依賴 `pdf.js-extract` 或 OpenDataLoader 原始格式，只讀取 `SourceBlock[]`（含選填 `provenance`）。
- 所有 rule candidate 必須保留 parser provenance，支援稽核與重現。
- MVP 先完成可展示、可驗證的 upload/parse/preview 迴路，再擴充更多 parser adapter。
- Preview 的核心契約是 `SourceBlock.page + SourceBlock.bbox`，不是 parser 原始座標。
- 目前不導入任何 DB；上傳檔、parse 結果與 preview state 只保存在本機暫存檔與 process memory，適合 PoC，不作為 production persistence 設計。

## Tech Stack

| 層級 | 技術 | 決策 |
|---|---|---|
| Runtime | Node.js `v20.20.2` (javascript) | 使用本機目前版本作為 PoC baseline |
| Backend framework | Fastify | 提供 upload API、原檔讀取 API、static assets 與 parser orchestration |
| Frontend framework | Vue.js 3 | 建立單頁 PDF parsing PoC |
| UI component | Element Plus | Upload、Select、Button、Alert、Tabs/Collapse、Loading、Empty state |
| Build tool | Vite | 開發 server、前端 build、Vue plugin |
| PDF preflight | `pdf.js-extract` | **統計、`PageTextStats`、頁面寬高**；ODL 為主時**不作為進入 SourceBlock 的正文來源**（僅 preflight） |
| Native 全文解析（可選） | `pdf.js-extract` | `parserBackend=pdfjs-extract` 時將 pdfjs 文字進 `SourceBlock` |
| PDF 主解析（ODL 路徑） | OpenDataLoader（`@opendataloader/pdf` + Java CLI） | dual-pass、回傳 **`mergedOdlItems`** 供 structural hole |
| 選用 OCR repair | eSearch-OCR + `onnxruntime-node`（CPU） | page-level，`parser: esearch-ocr-repair` |
| 整頁光柵（OCR） | Poppler `pdftoppm` | P0；**pdfjs-dist + Node canvas** 光柵備援列為 **P1**，尚未實作 |
| Node canvas（供 esearch-ocr） | `@napi-rs/canvas` | `setOCREnv`；與右側瀏覽器 pdf.js 無關 |
| PDF viewer | pdf.js browser renderer | 右側原檔 canvas render 與 bbox overlay 對齊 |
| Storage | Local temp files + in-memory index | 不使用 DB；server restart 後資料可遺失 |

## eSearch-OCR page-level repair（計畫對照）

### 已完成

- Trigger OR 合併：`scan_or_low_text`、`structural_hole`。
- `mergedOdlItems`（`itemsToBlocks` 捨棄前）→ `ingestPdf` → repair 觸發。
- Poppler 整頁 PNG、`SourceBlock.provenance`（raster、fallbackReasons、repairTriggers）、進階選項與 README 環境變數。
- eSearch：`init` singleton、layout（`analyzeLayout` 內嵌於 `ocr()`）、v5 det/rec、可選 docCls、preprocess → reraster DPI → v4 doc rec fallback、`p-limit` 頁級併發。
- 與 ODL blocks 合併（`mergeOdlAndOcr`）後 `dedupeBlocks`。

### 未完成 / 後續

- Trigger 分類與 repair blocks 的 **自動化 fixture／E2E**（需本地模型 + Poppler）。
- **每頁嘗試上限**（計畫所述 N 次）未硬性強制。
- **`OcrRepairAttempt` 結構化列舉**未獨立檔案。
- **OCR 子進程池**（對照 `odlRunner.mjs`）仍為可選增強。
- **UI 列出 structural hole**（除錯）：P2。
- **pdf.js Node 光柵**備援：P1。

## PoC 儲存策略

```text
PDF upload
  -> write original file to local temp directory
  -> parse and build PdfPreviewDocument
  -> store preview document in in-memory Map by documentId
  -> return documentId + originalPdfUrl + SourceBlock[]
```

限制：

- server 重啟後 preview index 會消失。
- 本機暫存檔需要基本 cleanup policy。
- 不支援跨機器部署、長期 audit、多人協作或歷史紀錄。
- 這是刻意的 PoC scope；production persistence 之後再評估 DB/object storage。

## 開發驗證標的

主要 fixture：

- `data/target.pdf`
- 檔案類型：PDF document, version 1.7
- 檔案大小：約 361 KB

用途：

- 作為 `POST /api/pdf/parse` 的本機 upload 驗證標的。
- 作為 `pdf.js-extract` preflight、page-level classification 與 `SourceBlock[]` normalization 的第一個固定測試檔。
- 作為左右雙欄 preview 的 smoke test：左側 parsed block 必須能對映到右側原始 PDF。
- 作為 bbox highlight 對齊的人工驗證標的。

驗證基準：

- 上傳 `data/target.pdf` 後，API 應回傳 `PdfPreviewDocument`。
- `PdfPreviewDocument.pageCount` 應大於 0。
- `PdfPreviewDocument.blocks` 應至少包含一個有 text、page、bbox、parser provenance 的 `SourceBlock`。
- 右側 PDF viewer 應能載入 `originalPdfUrl`。
- 點選至少一個左側 block 時，右側應 scroll 到對應頁並顯示 highlight。

## 使用者輸入模型

```ts
type PdfParseModeHint =
  | "auto"
  | "native_text"
  | "scanned_image"
  | "mixed_or_unknown";

type PdfAdvancedOptions = {
  forceNativeText?: boolean;
  forceOcr?: boolean;
  enableComplexTableParsing?: boolean;
  enableSafetyFiltering?: boolean;
  enableOcrRepair?: boolean;
  repairOnScanOrLowText?: boolean;
  repairOnStructuralHole?: boolean;
};

type PdfUploadRequest = {
  file: File;
  parseMode: PdfParseModeHint;
  advancedOptions?: PdfAdvancedOptions;
};
```

關鍵決策：

- `auto` 是預設值。
- `forceNativeText` 與 `forceOcr` 只能作為強 hint；後端仍需執行 preflight detection。
- 若偵測結果與使用者 hint 衝突，保留 warning 並以系統偵測與 quality check 優先。

## 內部資料模型

```ts
type PageDetection = {
  page: number;
  textItemCount: number;
  charCount: number;
  cjkCharRatio: number;
  whitespaceRatio: number;
  avgFontSize: number | null;
  bboxCoverageRatio: number;
  hasExtractableText: boolean;
  suspectedScanned: boolean;
  suspectedGarbledText: boolean;
  suspectedTableHeavy: boolean;
  suspectedHiddenOrOffPageText: boolean;
  suspectedCidFontEncoding: boolean;
  layoutClass: "native_text" | "scanned_image" | "mixed" | "suspicious" | "complex_layout";
  parserRecommendation: "pdfjs" | "opendataloader_default" | "opendataloader_hybrid" | "opendataloader_safety";
  reasons: string[];
};

type SourceBlock = {
  id: string;
  documentId: string;
  page: number;
  blockType: "heading" | "paragraph" | "table" | "list" | "footer" | "header" | "image_ocr" | "unknown";
  text: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
    coordinateSystem: "pdf-points" | "normalized";
  };
  parser: "pdfjs-extract" | "opendataloader-default" | "opendataloader-hybrid" | "opendataloader-safety" | "esearch-ocr-repair";
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
    repairTriggers?: ("scan_or_low_text" | "structural_hole")[];
  };
};

type PdfPreviewDocument = {
  documentId: string;
  fileName: string;
  pageCount: number;
  originalPdfUrl: string;
  detections: PageDetection[];
  blocks: SourceBlock[];
  warnings: string[];
};

type PreviewSelection = {
  blockId: string;
  page: number;
  bbox: SourceBlock["bbox"];
};
```

## 架構流程

```text
PDF Upload
  -> User Hint Capture
  -> pdf.js-extract Preflight
  -> Page-level Classification
  -> Parser Routing Plan
  -> Parser Execution
  -> SourceBlock Normalization
  -> Deduplication
  -> Quality Check
  -> Fallback Routing if Needed
  -> Build Preview Document
  -> Two-pane Source Preview
  -> Rule Candidate Extraction
  -> Human Approval
  -> RuleSpec / Detector Draft
```

## PoC UI 流程

```text
Page Load
  -> Empty State: Upload PDF
  -> User selects parse mode hint
  -> User uploads PDF
  -> Backend returns PdfPreviewDocument
  -> Left Pane: Parsed SourceBlock list grouped by page
  -> Right Pane: Original PDF rendered page by page
  -> User clicks a SourceBlock
  -> App sets PreviewSelection
  -> Right Pane scrolls to target page
  -> Right Pane draws bbox highlight over PDF canvas/text layer
  -> User clicks PDF highlight
  -> Left Pane scrolls to matching SourceBlock
```

## 詳細 Pseudocode

```ts
async function ingestPdf(input: PdfIngestionInput): Promise<PdfIngestionResult> {
  const document = await storeUpload(input.file);
  const userHint = normalizeUserHint(input.parseMode, input.advancedOptions);

  const preflight = await pdfjsPreflight(document);
  const detections = preflight.pages.map((page) => classifyPage(page, userHint));
  const routingPlan = buildRoutingPlan(detections, userHint);

  const firstPassBlocks = await executeRoutingPlan(document, routingPlan);
  const normalizedBlocks = normalizeParserBlocks(firstPassBlocks);
  const dedupedBlocks = dedupeBlocks(normalizedBlocks, {
    key: ["page", "sourceHash"],
    bboxOverlapThreshold: 0.85,
  });

  const qualityReport = evaluateExtractionQuality(dedupedBlocks, detections);
  if (qualityReport.requiresFallback) {
    const fallbackPlan = buildFallbackPlan(qualityReport, routingPlan);
    const fallbackBlocks = await executeRoutingPlan(document, fallbackPlan);
    const mergedBlocks = mergeFallbackBlocks(dedupedBlocks, normalizeParserBlocks(fallbackBlocks));
    return buildReviewPayload(document, mergedBlocks, detections, qualityReport);
  }

  return buildReviewPayload(document, dedupedBlocks, detections, qualityReport);
}
```

```ts
async function parsePdfForPreview(request: PdfUploadRequest): Promise<PdfPreviewDocument> {
  const result = await ingestPdf({
    file: request.file,
    parseMode: request.parseMode,
    advancedOptions: request.advancedOptions,
  });

  return {
    documentId: result.document.id,
    fileName: result.document.fileName,
    pageCount: result.document.pageCount,
    originalPdfUrl: result.document.originalPdfUrl,
    detections: result.detections,
    blocks: result.sourceBlocks,
    warnings: result.warnings,
  };
}
```

```ts
function classifyPage(page: PdfjsPreflightPage, hint: PdfParseHint): PageDetection {
  const stats = computeTextAndLayoutStats(page);
  const suspectedScanned = stats.charCount < 30 || !stats.hasExtractableText;
  const suspectedGarbledText = hasBadUnicodeSignal(stats) || hasAbnormalWhitespace(stats);
  const suspectedTableHeavy = hasManyShortAlignedItems(stats) || hasRepeatedXYColumns(stats);
  const suspectedHiddenOrOffPageText = hasOffPageBbox(page) || hasInvisibleOrTinyText(page);

  if (suspectedHiddenOrOffPageText || suspectedGarbledText) {
    return recommend("suspicious", "opendataloader_safety", stats);
  }
  if (suspectedScanned) {
    return recommend("scanned_image", "opendataloader_hybrid", stats);
  }
  if (suspectedTableHeavy || hasMultiColumnSignal(stats)) {
    return recommend("complex_layout", "opendataloader_default", stats);
  }
  return recommend("native_text", "pdfjs", stats);
}
```

```ts
function buildRoutingPlan(detections: PageDetection[], hint: PdfParseHint): ParserRoutingPlan {
  return groupContiguousPages(detections).map((group) => {
    if (hint.forceOcr && group.hasLowNativeTextQuality) {
      return route(group.pages, "opendataloader_hybrid", "hint_plus_detection");
    }
    if (hint.forceNativeText && group.allPagesHaveGoodNativeText) {
      return route(group.pages, "pdfjs", "hint_allowed_by_detection");
    }
    return route(group.pages, group.parserRecommendation, "system_detection");
  });
}
```

```ts
function selectSourceBlock(block: SourceBlock): PreviewSelection {
  return {
    blockId: block.id,
    page: block.page,
    bbox: toNormalizedBbox(block.bbox),
  };
}

function onParsedBlockClick(block: SourceBlock): void {
  const selection = selectSourceBlock(block);
  setActiveSelection(selection);
  scrollPdfViewerToPage(selection.page);
  drawPdfHighlight(selection.page, selection.bbox);
}

function onPdfHighlightClick(blockId: string): void {
  setActiveBlockId(blockId);
  scrollParsedResultToBlock(blockId);
}
```

## 階段規劃

| 階段 | 狀態 | 目標 | 產出 | 驗證 |
|---|---|---|---|---|
| P0.1 規格與資料模型 | complete | 定義 hint、detection、routing、SourceBlock schema | 本文件、findings、progress | 文件可審查 |
| P0.2 PoC 專案骨架 | complete | 建立前後端最小可跑結構 | server、web page、測試設定 | build / smoke test |
| P0.3 Fastify 上傳與 preview API | complete | 支援 PDF upload，使用本機暫存與 memory index 回傳 `PdfPreviewDocument` | `POST /api/pdf/parse`、`GET /api/pdf/:documentId/original` | 上傳 fixture 可取得 blocks 與原檔 URL |
| P0.4 pdf.js-extract preflight | complete | 每頁抽 text item、bbox、基礎統計 | `pdfjsPreflight()` | 使用 `data/target.pdf` 驗證 page count、text stats、bbox stats |
| P0.5 page-level classification | complete | 依 char count、CJK ratio、bbox、table signal 做分類 | `classifyPage()` | table-driven unit tests（可再補） |
| P0.6 SourceBlock normalization | complete | 先完成 pdf.js path 的 block grouping、bbox normalization | normalized schema | bbox / hash / provenance tests |
| P0.7 左右雙欄 Preview UI | complete | 左側 parsing blocks，右側 PDF 原檔 | upload page + PDF viewer | 使用 `data/target.pdf` 手動點選 block 可定位原檔 |
| P0.8 區塊連動與 highlight | complete | SourceBlock 點選後 scroll/highlight PDF bbox，PDF highlight 可回跳左側 | selection state + overlay | 使用 `data/target.pdf` 做 browser smoke test |
| P0.9 parser routing 與 warning | complete | 產生 page range routing plan，整合 user hint 並顯示 warning | `buildRoutingPlan()` + UI warning | hint 衝突測試（可再補） |
| P0.10 dedup + basic quality fallback | complete | 避免 OCR/text layer 重複，品質差時標記 fallback | `dedupeBlocks()`、`evaluateExtractionQuality()` | overlap / fallback tests（可再補） |
| P1 每頁 routing 優化 | pending | 從整份 routing 升級為 page/group routing | page group planner | mixed PDF fixtures |
| P1.1 OpenDataLoader adapter + Backend Selector | complete | UI backend selector；`@opendataloader/pdf`；dual-pass merge；`mergedOdlItems` | `PdfUploadPanel`、`opendataloaderAdapter.ts`、`ingestPdf.ts` | target.pdf ODL；TFDA 等手動驗證 |
| P1.2 eSearch-OCR page-level repair | complete | Poppler 光柵 + eSearch；trigger 分類；`provenance`；進階開關；與 ODL 合併去重 | `src/ingestion/ocr/*` | 需 `ESEARCH_OCR_MODEL_DIR` + Poppler 方能 E2E；關閉時 target.pdf 迴歸 |
| P1.3 pdf.js Node 光柵備援（OCR） | pending | Poppler 不可用時以 pdfjs+canvas 光柵化（計畫 P1） | 新 adapter | CI / 無 Poppler 環境 |
| P1.4 OCR worker 子進程池（可選） | pending | 隔離 ORT / 對齊 `odlRunner` 模式 | process pool | 高併發與記憶體評估 |
| P2 Rule candidate extraction | pending | 從 preview blocks 產生規則候選 | candidate extractor | candidate source mapping tests |
| P2.1 進階 quality fallback | pending | rule candidate 對不到 source、表格破碎、亂碼時重跑 | fallback policy | end-to-end fixtures |
| P2.2 UI 顯示 structural hole 列表（除錯） | pending | 除錯 merged ODL 空洞 | panel / dev flag | 手動 |

## 模組邊界建議

```text
src/
  server/
    app.ts
    main.ts
    routes/
      pdfParseRoute.ts
    storage/
      uploadStore.ts
      previewDocumentStore.ts
  ingestion/
    types.ts
    ingestPdf.ts
    preflight/
      pdfjsPreflight.ts
      pageStats.ts
    detection/
      classifyPage.ts
      routingPlan.ts
    parsers/
      pdfjsAdapter.ts
      opendataloaderAdapter.ts
    normalize/
      sourceBlock.ts
      bbox.ts
      dedupe.ts
      textOverlap.ts
    quality/
      extractionQuality.ts
    review/
      buildReviewPayload.ts
    ocr/
      ocrTriggers.ts
      structuralHoles.ts
      popplerRasterize.ts
      bboxRaster.ts
      nodeCanvasEnv.ts
      modelPaths.ts
      esearchOcrRepair.ts
      mergeOdlAndOcr.ts
  web/
    main.ts
    App.vue
    pages/
      PdfParsePocPage.vue
    components/
      PdfUploadPanel.vue
      ParsedBlocksPane.vue
      PdfSourceViewer.vue
      ParserWarnings.vue
    state/
      previewSelection.ts
```

## PoC 頁面設計

### Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ Upload toolbar: file picker + parse mode + parse button      │
├───────────────────────────────┬─────────────────────────────┤
│ Left: Parsed SourceBlocks      │ Right: Original PDF          │
│ - grouped by page              │ - rendered PDF pages         │
│ - block type / confidence      │ - bbox highlight overlay     │
│ - parser warning badges        │ - scroll to selected block   │
└───────────────────────────────┴─────────────────────────────┘
```

### Frontend state

```ts
type PdfParsePocState = {
  status: "idle" | "uploading" | "parsing" | "ready" | "error";
  previewDocument: PdfPreviewDocument | null;
  activeBlockId: string | null;
  activeSelection: PreviewSelection | null;
  errorMessage: string | null;
};
```

Vue implementation notes：

- 使用 Vue 3 Composition API 管理 upload status、`PdfPreviewDocument`、`activeBlockId` 與 `activeSelection`。
- 使用 Element Plus `el-upload` 或原生 file input 搭配 Element Plus buttons；若需要完全控制 multipart request，優先用自訂 upload flow。
- 使用 Element Plus `el-select` 呈現 parse mode，`el-alert` 顯示 parser warnings，`el-scrollbar` 承載左右 pane。
- Vite dev server 只負責前端開發；API 由 Fastify 提供。開發時可用 Vite proxy 轉發 `/api` 到 Fastify。

### 互動規則

- 左側 block hover：右側 PDF 顯示淡色 bbox preview。
- 左側 block click：設定 active block，右側 scroll 到頁面並顯示強 highlight。
- 右側 bbox click：左側 scroll 到對應 block。
- 若 block 沒有可信 bbox，左側仍顯示文字，但右側顯示 `無可定位座標` warning。
- 若頁面被判定 scanned / suspicious，左側頁面群組要顯示 parser warning。

## P1.1 Parser Backend Selector 設計

### 目標

在上傳 UI 新增「解析後端」選項，讓使用者明確選擇使用 `pdfjs-extract` 或 `@opendataloader/pdf`；後端依選擇路由並將 parser provenance 保留在 `SourceBlock` 中。

### UI 異動

新增 `parserBackend` 選項至 `PdfUploadPanel`，顯示在 parse mode 旁：

| 選項 | 值 | 說明 |
|---|---|---|
| 自動路由（Auto） | `auto` | 依 preflight detection 決定 parser（現有行為） |
| pdf.js-extract | `pdfjs-extract` | 強制使用 pdfjs native text path |
| OpenDataLoader | `opendataloader` | 強制使用 `@opendataloader/pdf` Java CLI |

### 新增型別

```ts
type ParserBackend = "auto" | "pdfjs-extract" | "opendataloader";

// 擴充 IngestionInput
type IngestionInput = {
  ...
  parserBackend?: ParserBackend;  // 預設 "auto"
  ocrRepairConcurrency?: number;
};

// ODL JSON 單一元素
type OdlJsonItem = {
  type: "heading" | "paragraph" | "table" | "list" | "image" | "caption" | "formula" | string;
  id: number;
  "page number": number;
  "bounding box": [number, number, number, number]; // [left, bottom, right, top] PDF points
  content?: string;
  "heading level"?: number;
  "font size"?: number;
};
```

### Backend 路由邏輯

```ts
async function ingestPdf(input: IngestionInput) {
  const preflight = await pdfjsPreflight(input.filePath);  // 永遠執行，取 page dimensions

  if (input.parserBackend === "opendataloader") {
    // 全文件交給 ODL，不做 detection routing
    const blocks = await runOpendataloaderAdapter(input.filePath, preflight, input.documentId);
    ...
  } else if (input.parserBackend === "pdfjs-extract") {
    // 強制 pdfjs，全頁
    const blocks = runPdfjsAdapter(preflight.rawPages, allPages, input.documentId);
    ...
  } else {
    // auto：現有 detection → routing 流程
    ...
  }
}
```

### ODL Adapter 實作細節

**依賴**：`@opendataloader/pdf` v2.4.3（Node.js wrapper for Java CLI）
**Java 需求**：Java 11+（本機 OpenJDK 23.0.1 via Homebrew `/opt/homebrew/opt/openjdk`）

**執行流程**：
```ts
import { convert } from '@opendataloader/pdf';

// 1. 建立 per-document 輸出目錄
const outDir = join(TMP_DIR, `odl-${documentId}`);

// 2. 呼叫 ODL（在 JAVA_HOME 設定下執行）
process.env.JAVA_HOME = '/opt/homebrew/opt/openjdk';
await convert([filePath], { outputDir: outDir, format: 'json' });

// 3. 讀取 {stem}.json
const jsonPath = join(outDir, `${documentId}.json`);
const items: OdlJsonItem[] = JSON.parse(readFileSync(jsonPath, 'utf8'));

// 4. 正規化為 SourceBlock[]
```

**ODL bbox → normalized bbox**：

ODL 格式：`[left, bottom, right, top]`（PDF points，y from bottom）

```ts
// [left, bottom, right, top] → toNormalizedBbox(x, y, w, h, pageW, pageH)
toNormalizedBbox(left, bottom, right - left, top - bottom, pageWidth, pageHeight)
```

**ODL type → SourceBlock.blockType 對映**：

| ODL type | SourceBlock.blockType |
|---|---|
| heading | heading |
| paragraph | paragraph |
| table | table |
| list | list |
| image, picture | image_ocr |
| caption, formula | unknown |
| 其他 | unknown |

### 環境需求補充

| 項目 | 值 |
|---|---|
| `@opendataloader/pdf` | v2.4.3 |
| Java 需求 | Java 11+ |
| 本機 Java | OpenJDK 23.0.1 (`/opt/homebrew/opt/openjdk`) |
| JAVA_HOME 設定 | Node.js process 啟動前或 adapter 內設定 |

### 風險

| 風險 | 緩解 |
|---|---|
| Java CLI 啟動耗時（JVM cold start ~1-3s） | 每次 parse request 接受 cold start 延遲；PoC 不需批次優化 |
| ODL 輸出目錄需 cleanup | 同 tmp/ 清理 policy；per-document 子目錄，cleanup 時一同刪除 |
| ODL page dimensions 未包含於 JSON 輸出 | 以 preflight 取得 pageInfo.width/height |
| OCR / hybrid mode 未啟用 | P1.1 先做 fast（local）mode；hybrid mode 留 P1.2 |

## 主要取捨

- 先用 `pdf.js-extract` 做 preflight：速度與 Node.js 整合成本較低，但不能 OCR。
- OpenDataLoader 放在 complex / scanned / suspicious / fallback path：較穩，但成本與部署複雜度較高。
- page-level routing 比 document-level routing 複雜，但更符合企業混合 PDF。
- SourceBlock 先定義完整 provenance 欄位，避免後續 rule audit 補資料困難。
- PoC UI 先做解析結果與 PDF 原檔 bbox 對映，不先做完整 rule editor；這能最快驗證 parser output 是否真的可被人審查。
- 第一版可先只實作 `pdf.js-extract` native path 與 warning/fallback placeholder；OpenDataLoader adapter 留在 P1，避免 PoC 被部署複雜度卡住。
- 不引入 DB 讓 PoC 建置更快，但所有 parse 結果都不是 durable state；這是目前刻意接受的限制。

## 完成定義

- 使用者可選「自動判斷、原生 PDF、掃描 PDF、混合/不確定」。
- 使用者可上傳 PDF 並得到 `PdfPreviewDocument`。
- 頁面左側可看到 parsing 後的 `SourceBlock[]`，右側可看到原始 PDF。
- `data/target.pdf` 可作為固定驗證標的完成 upload、parse、preview、highlight smoke test。
- 點選左側任一有 bbox 的 SourceBlock，可連動右側 PDF scroll 到對應頁並 highlight 原文區塊。
- 點選右側 highlight，可回到左側對應 SourceBlock。
- 後端永遠執行 preflight detection。
- 系統能輸出每頁 detection、routing reason、parser warning。
- Fastify API 可在本機 Node.js `v20.20.2` 執行。
- Vue 3 + Element Plus + Vite 可完成單頁 upload/preview UI。
- 不依賴 DB；server restart 後既有 preview session 可失效。
- Rule candidate extraction 僅依賴 `SourceBlock[]`。
- 至少具備原生、掃描、混合、表格、hidden/off-page 疑慮的測試 fixture。
- 具備 `SourceBlock` provenance（parser / model 標籤 / 選用 OCR 時之 raster 與 fallback 鏈）；`parserBackend=auto` 與 `opendataloader` 均以 **OpenDataLoader dual-pass** 為主，可選 **eSearch-OCR repair**（預設關）。
