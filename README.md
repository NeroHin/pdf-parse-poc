# pdf-parse-poc

> PDF 解析 PoC：upload → parse → block preview → source mapping 端到端展示

一個可執行的 PDF 解析概念驗證專案。使用者上傳 PDF 後，系統自動執行 preflight detection、page-level classification、parser routing 與 SourceBlock normalization；前端提供左右雙欄 preview，左側顯示解析結果，右側顯示原始 PDF，點選任一 block 可在原檔中定位並 highlight 對應 bbox。

![screenshot](docs/screenshot.png)

## Features

- **Page-level PDF detection** — 每頁獨立偵測：原生文字 / 掃描影像 / 複雜排版 / 可疑內容
- **Parser routing** — 依偵測結果與使用者 hint 自動選擇 parser 路徑
- **SourceBlock normalization** — 統一 bbox 座標系、block grouping、dedup、confidence
- **雙向連動 preview** — 點左側 block → 右側 scroll + highlight；點右側 highlight → 左側 scroll
- **完整 provenance** — 每個 block 保留 page、bbox、parser、parserVersion、sourceHash
- **No DB** — PoC 使用本機暫存 + process memory，無需資料庫

## Tech Stack

| 層級 | 技術 |
|---|---|
| Runtime | Node.js ≥ 18 |
| Backend | Fastify 4 |
| Frontend | Vue 3 + Element Plus |
| Build tool | Vite 5 |
| PDF parsing | pdf.js-extract |
| PDF viewer | pdfjs-dist (browser canvas) |
| Language | TypeScript |

## Prerequisites

- Node.js 18 或以上
- npm 9 或以上

```bash
node --version  # >= 18.0.0
npm --version   # >= 9.0.0
```

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/your-org/pdf-parse-poc.git
cd pdf-parse-poc
npm install
```

### 2. Start Development Servers

```bash
npm run dev
```

這個指令會同時啟動：

- **Fastify API server** — `http://localhost:3000`
- **Vite dev server** — `http://localhost:5173`

Vite 已設定 proxy，所有 `/api` 請求自動轉發至 Fastify，無需處理 CORS。

### 3. Open the App

瀏覽器開啟 `http://localhost:5173`，上傳任一 PDF 即可開始。

## Usage

1. 在頂部工具列選擇 **解析模式**（預設：自動判斷）
2. 點選 **上傳 PDF** 選擇檔案
3. 系統完成 preflight detection 與 parsing 後，左右雙欄自動展開
4. **左側**：解析後的 SourceBlock 列表，依頁碼分組
5. **右側**：原始 PDF canvas render，帶 bbox highlight overlay
6. 點選左側任一 block → 右側 scroll 到對應頁並顯示橙色 highlight
7. 點選右側 highlight → 左側 scroll 到對應 block

### 解析模式選項

| 模式 | 說明 |
|---|---|
| 自動判斷（建議） | 系統執行 preflight，依每頁偵測結果決定 parser |
| 原生 PDF / 可選取文字 | hint 偏好 native text path |
| 掃描 PDF / 圖片型 PDF | hint 偏好 OCR/hybrid path |
| 混合 PDF / 不確定 | hint 標示混合文件 |

### 進階選項

| 選項 | 說明 |
|---|---|
| 強制使用原生文字解析 | 偵測允許時使用 pdfjs-extract native path |
| 強制使用 OCR / 掃描解析 | 偵測建議時使用 OpenDataLoader hybrid path |
| 啟用複雜表格解析 | 觸發 OpenDataLoader default path |
| 啟用安全過濾 | 過濾 hidden/off-page text（safety path） |

> **注意**：進階選項只作為 routing hint。系統仍會執行 preflight detection；若偵測結果與 hint 衝突，以系統偵測優先並顯示 warning。

## API Reference

### `POST /api/pdf/parse`

上傳 PDF 並取得解析結果。

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | ✓ | PDF 檔案（上限 50 MB） |
| `parseMode` | string | — | `auto` \| `native_text` \| `scanned_image` \| `mixed_or_unknown`（預設 `auto`） |
| `advancedOptions` | JSON string | — | `PdfAdvancedOptions` 物件 |

**Response** — `PdfPreviewDocument`

```jsonc
{
  "documentId": "uuid",
  "fileName": "example.pdf",
  "pageCount": 14,
  "originalPdfUrl": "/api/pdf/{documentId}/original",
  "detections": [ /* PageDetection[] */ ],
  "blocks": [ /* SourceBlock[] */ ],
  "warnings": []
}
```

### `GET /api/pdf/:documentId/original`

取得原始 PDF 二進位檔案（`application/pdf`）。

### `GET /api/health`

```json
{ "status": "ok" }
```

## Project Structure

```
pdf-parse-poc/
├── src/
│   ├── server/                    # Fastify backend
│   │   ├── main.ts
│   │   ├── app.ts
│   │   ├── routes/
│   │   │   └── pdfParseRoute.ts
│   │   └── storage/
│   │       ├── uploadStore.ts     # local tmp file management
│   │       └── previewDocumentStore.ts  # in-memory Map
│   ├── ingestion/                 # PDF processing pipeline
│   │   ├── types.ts               # shared type definitions
│   │   ├── ingestPdf.ts           # pipeline orchestrator
│   │   ├── preflight/
│   │   │   ├── pdfjsPreflight.ts  # pdf.js-extract runner
│   │   │   └── pageStats.ts       # per-page text statistics
│   │   ├── detection/
│   │   │   ├── classifyPage.ts    # page-level layout classifier
│   │   │   └── routingPlan.ts     # parser routing plan builder
│   │   ├── parsers/
│   │   │   ├── pdfjsAdapter.ts    # native text extraction
│   │   │   └── opendataloaderAdapter.ts  # OCR/hybrid (P1)
│   │   ├── normalize/
│   │   │   ├── sourceBlock.ts     # block grouping & normalization
│   │   │   ├── bbox.ts            # coordinate system conversion
│   │   │   └── dedupe.ts          # bbox overlap deduplication
│   │   ├── quality/
│   │   │   └── extractionQuality.ts
│   │   └── review/
│   │       └── buildReviewPayload.ts
│   └── web/                       # Vue 3 frontend
│       ├── main.ts
│       ├── App.vue
│       ├── pages/
│       │   └── PdfParsePocPage.vue
│       ├── components/
│       │   ├── PdfUploadPanel.vue
│       │   ├── ParsedBlocksPane.vue
│       │   └── PdfSourceViewer.vue
│       │   └── ParserWarnings.vue
│       └── state/
│           └── previewSelection.ts
├── data/
│   └── target.pdf                 # development fixture
├── docs/
│   └── pdf-ingestion-parser-router/
│       ├── task_plan.md
│       ├── findings.md
│       └── progress.md
├── tmp/                           # uploaded PDFs (gitignored)
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Data Model

### `SourceBlock`

```typescript
type SourceBlock = {
  id: string;
  documentId: string;
  page: number;
  blockType: "heading" | "paragraph" | "table" | "list" | "footer" | "header" | "image_ocr" | "unknown";
  text: string;
  bbox: {
    x: number;        // normalized [0, 1], origin top-left
    y: number;
    width: number;
    height: number;
    coordinateSystem: "normalized";
  };
  parser: "pdfjs-extract" | "opendataloader-default" | "opendataloader-hybrid" | "opendataloader-safety";
  parserVersion: string;
  extractionMode: "native_text" | "ocr" | "hybrid" | "safety";
  confidence: number;
  warnings: string[];
  sourceHash: string; // SHA-256(page:text)[0:16]
};
```

### `PageDetection`

```typescript
type PageDetection = {
  page: number;
  layoutClass: "native_text" | "scanned_image" | "complex_layout" | "suspicious" | "mixed";
  parserRecommendation: "pdfjs" | "opendataloader_default" | "opendataloader_hybrid" | "opendataloader_safety";
  charCount: number;
  cjkCharRatio: number;
  suspectedScanned: boolean;
  suspectedTableHeavy: boolean;
  suspectedHiddenOrOffPageText: boolean;
  reasons: string[];
};
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | 同時啟動 Fastify（port 3000）與 Vite（port 5173） |
| `npm run dev:server` | 只啟動 Fastify server（tsx watch） |
| `npm run dev:web` | 只啟動 Vite dev server |
| `npm run build` | 前端 production build → `dist/web/` |
| `npm run typecheck` | TypeScript 型別檢查（不產生輸出） |

## Detection Logic

系統對每頁 PDF 獨立執行以下偵測流程：

```
pdf.js-extract preflight
  → computePageStats (charCount, cjkCharRatio, whitespaceRatio, bboxCoverageRatio, ...)
  → classifyPage
      if hidden/off-page text or garbled    → suspicious  → opendataloader_safety
      else if charCount < 20                → scanned     → opendataloader_hybrid
      else if table-heavy (non-CJK only)    → complex     → opendataloader_default
      else                                  → native_text → pdfjs-extract
  → buildRoutingPlan (group contiguous pages)
  → executeRoutingPlan
  → dedupeBlocks (bbox overlap + sourceHash)
  → evaluateExtractionQuality
```

> CJK 文件（`cjkCharRatio > 0.3`）會跳過 table-heavy 偵測，因為 CJK PDF 渲染本來就會將每個字元輸出為獨立 item。

## Limitations (PoC Scope)

- Server 重啟後，所有 preview session 失效（無 persistent storage）
- `tmp/` 目錄中的暫存 PDF 依 2 小時 TTL 清理
- OpenDataLoader adapter 尚未接入（P1）；掃描 / 複雜排版頁面目前回傳空 blocks
- 大型 PDF（> 100 頁）一次 render 全頁可能造成瀏覽器延遲
- 不支援多節點部署、多租戶或長期 audit

## Roadmap

| 階段 | 內容 |
|---|---|
| **P0** ✅ | upload → preflight → classification → SourceBlock → two-pane preview → bbox highlight |
| **P1** | OpenDataLoader adapter（OCR / hybrid / safety path）；per-page routing 優化 |
| **P2** | Rule candidate extraction from SourceBlock[]；進階 quality fallback |
| **P2.1** | Human approval gate；RuleSpec / Detector draft 產生 |

## Contributing

1. Fork the repo
2. Create your feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

## License

[MIT](LICENSE)
