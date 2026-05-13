# PDF Ingestion Parser Router 任務計畫

## 目標

建立一個簡單但端到端可操作的 PDF parsing PoC。使用者可在單一頁面上傳 PDF、指定或保留自動解析模式；後端完成 preflight detection、parser routing 與 `SourceBlock[]` normalization；前端提供左右雙欄 preview，左側顯示 parsing 結果，右側顯示原始 PDF，點選任一 parsing 區塊時能在原檔中定位並 highlight 對應 bbox。PoC 先證明 upload -> parse -> block preview -> source mapping 的核心體驗，再擴充 rule candidate extraction。

## 原則

- 使用者選項只能影響 routing preference，不能覆蓋 system detection 與 quality fallback。
- 偵測與路由以 page-level 為基本單位，不以整份文件單一分類決定。
- 上層 rule extraction 不直接依賴 `pdf.js-extract` 或 OpenDataLoader 原始格式，只讀取 `SourceBlock[]`。
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
| PDF preflight/parser | `pdf.js-extract` | 第一版 native text + bbox extraction |
| PDF viewer | pdf.js browser renderer | 右側原檔 canvas render 與 bbox overlay 對齊 |
| Storage | Local temp files + in-memory index | 不使用 DB；server restart 後資料可遺失 |

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
  parser: "pdfjs-extract" | "opendataloader-default" | "opendataloader-hybrid" | "opendataloader-safety";
  parserVersion: string;
  extractionMode: "native_text" | "ocr" | "hybrid" | "safety";
  confidence: number;
  warnings: string[];
  sourceHash: string;
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
| P0.2 PoC 專案骨架 | pending | 建立前後端最小可跑結構 | server、web page、測試設定 | build / smoke test |
| P0.3 Fastify 上傳與 preview API | pending | 支援 PDF upload，使用本機暫存與 memory index 回傳 `PdfPreviewDocument` | `POST /api/pdf/parse`、`GET /api/pdf/:documentId/original` | 上傳 fixture 可取得 blocks 與原檔 URL |
| P0.4 pdf.js-extract preflight | pending | 每頁抽 text item、bbox、基礎統計 | `pdfjsPreflight()` | 使用 `data/target.pdf` 驗證 page count、text stats、bbox stats |
| P0.5 page-level classification | pending | 依 char count、CJK ratio、bbox、table signal 做分類 | `classifyPage()` | table-driven unit tests |
| P0.6 SourceBlock normalization | pending | 先完成 pdf.js path 的 block grouping、bbox normalization | normalized schema | bbox / hash / provenance tests |
| P0.7 左右雙欄 Preview UI | pending | 左側 parsing blocks，右側 PDF 原檔 | upload page + PDF viewer | 使用 `data/target.pdf` 手動點選 block 可定位原檔 |
| P0.8 區塊連動與 highlight | pending | SourceBlock 點選後 scroll/highlight PDF bbox，PDF highlight 可回跳左側 | selection state + overlay | 使用 `data/target.pdf` 做 browser smoke test |
| P0.9 parser routing 與 warning | pending | 產生 page range routing plan，整合 user hint 並顯示 warning | `buildRoutingPlan()` + UI warning | hint 衝突測試 |
| P0.10 dedup + basic quality fallback | pending | 避免 OCR/text layer 重複，品質差時標記 fallback | `dedupeBlocks()`、`evaluateExtractionQuality()` | overlap / fallback tests |
| P1 每頁 routing 優化 | pending | 從整份 routing 升級為 page/group routing | page group planner | mixed PDF fixtures |
| P1.1 OpenDataLoader adapter | pending | 將掃描/複雜/可疑頁接入 OpenDataLoader | adapter + parser execution | scanned / table fixture |
| P2 Rule candidate extraction | pending | 從 preview blocks 產生規則候選 | candidate extractor | candidate source mapping tests |
| P2.1 進階 quality fallback | pending | rule candidate 對不到 source、表格破碎、亂碼時重跑 | fallback policy | end-to-end fixtures |

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
    quality/
      extractionQuality.ts
    review/
      buildReviewPayload.ts
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
- bbox 座標在 preview 可正確對齊，且 provenance 可回溯到 page、bbox、parser、parser version、source hash。
