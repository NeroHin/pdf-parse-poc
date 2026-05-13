# PDF Ingestion Parser Router 進度紀錄

## 2026-05-13

### 已完成

- 確認專案位置：`/Users/nero/dev/pdf-parse-poc`。
- 確認目前專案僅有 `README.md`，尚未有 Node.js package、src 或測試骨架。
- 建立規劃目錄：`docs/pdf-ingestion-parser-router/`。
- 建立 `task_plan.md`，包含目標、資料模型、架構流程、pseudocode、階段規劃、模組邊界、取捨與完成定義。
- 建立 `findings.md`，記錄目前 repo 狀態、需求摘要、架構判斷、routing 規則、MVP UI 行為、風險與非範圍。
- 建立 `progress.md`，作為後續工作日誌。

### 決策

- 規劃檔放在 `docs/pdf-ingestion-parser-router/`，避免污染專案根目錄，並符合使用者允許新增 `docs/` folder 的要求。
- 第一版設計以 page-level detection 為核心，即使 parser execution 可先用 contiguous page groups 批次處理。
- `SourceBlock[]` 是 rule extraction 前的唯一穩定合約。

### 尚未執行

- 尚未建立 Node.js 專案骨架。
- 尚未安裝 `pdf.js-extract` 或 OpenDataLoader 相關依賴。
- 尚未建立 PDF fixture 與自動化測試。

### 錯誤紀錄

| 錯誤 | 嘗試次數 | 解決方案 |
|---|---:|---|
| 無 | 0 | 無 |

## 2026-05-13 補充：PoC Preview 需求

### 已完成

- 將目標從純 parser router 規劃補強為簡單端到端 PoC：PDF upload、parsing、左右雙欄 preview、SourceBlock 與原始 PDF bbox 連動。
- 更新 `task_plan.md`：
  - 新增 `PdfUploadRequest`、`PdfPreviewDocument`、`PreviewSelection`。
  - 新增 PoC UI 流程與互動 pseudocode。
  - 調整 P0 階段，將 `POST /api/pdf/parse`、左右雙欄 preview、區塊連動與 highlight 納入 MVP。
  - 新增前端模組邊界建議。
- 更新 `findings.md`：
  - 補充 PoC preview 成功標準。
  - 補充雙欄 layout、左側 block list、右側 PDF viewer、雙向連動、API 與 UI 風險。

### 決策

- PoC 第一個成功標準是 parser output 能被原始 PDF 對照審查，不是先完成 RuleSpec 產生。
- 若要 bbox highlight 精準，右側原檔 preview 應優先採 pdf.js canvas renderer 加 overlay，而不是單純 `<iframe>`。
- 第一版可先完成 `pdf.js-extract` native path 與 OpenDataLoader adapter placeholder，OpenDataLoader 實際接入延後到 P1。

### 尚未執行

- 尚未建立實際 upload page。
- 尚未建立 `/api/pdf/parse`。
- 尚未驗證 bbox overlay 與 PDF render scale 對齊。

## 2026-05-13 補充：Tech Stack 與 No-DB Scope

### 已完成

- 確認本機 Node.js 版本為 `v20.20.2`。
- 更新 `task_plan.md`：
  - 新增 Tech Stack：Node.js `v20.20.2`、Fastify、Vue.js 3、Element Plus、Vite、`pdf.js-extract`、pdf.js browser renderer。
  - 新增 PoC 儲存策略：local temp files + in-memory index。
  - 明確記錄目前不導入 DB。
  - 將模組邊界改為 Vue `.vue` 結構與 Fastify server 結構。
- 更新 `findings.md`：
  - 新增 Tech Stack 發現。
  - 新增 No-DB 邊界。
  - 新增 package 建議與 no-DB 風險。

### 決策

- PoC 使用本機 Node.js `v20.20.2` 作為 runtime baseline。
- Backend framework 使用 Fastify。
- UI 使用 Vue.js 3 + Element Plus。
- Build tool 使用 Vite。
- 目前不加入 DB；server restart 後 preview session 可失效。

### 尚未執行

- 尚未建立 `package.json`。
- 尚未安裝 Fastify、Vue、Element Plus、Vite 或 PDF parsing/viewer 套件。
- 尚未實作暫存檔 cleanup policy。

## 2026-05-13 P0.2–P0.10 實作完成

### 已完成

- 建立完整 Node.js/TypeScript 專案骨架：`package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`。
- 實作 Fastify 後端（`src/server/`）：
  - `POST /api/pdf/parse`：multipart 上傳，回傳 `PdfPreviewDocument`。
  - `GET /api/pdf/:documentId/original`：回傳原始 PDF 檔案串流。
  - `GET /api/health`：健康檢查。
  - In-memory `Map<documentId, PdfPreviewDocument>` + 本機暫存 `tmp/` 目錄。
- 實作 `pdf.js-extract` preflight（`src/ingestion/preflight/`）：
  - 修正 `pdf.js-extract` 使用 `x/y` 直接座標而非 `transform` 矩陣。
  - CJK 文件 charCount、cjkCharRatio、whitespaceRatio、bboxCoverageRatio 等統計。
- 實作 page-level classification（`src/ingestion/detection/`）：
  - 加入 CJK 防護：`cjkCharRatio > 0.3` 時跳過 table-heavy 偵測。
  - routing plan + warning generator。
- 實作 SourceBlock normalization（`src/ingestion/normalize/`）：
  - pdf.js-extract 座標 (x, y from bottom-left) → normalized [0,1] (top-left origin)。
  - 鄰近 Y 行合併成 paragraph group。
  - `dedupeBlocks` with bbox overlap + sourceHash。
- 實作 parsers（`src/ingestion/parsers/`）：
  - `pdfjsAdapter.ts`：native text path。
  - `opendataloaderAdapter.ts`：placeholder（P1 再實作）。
- 實作 quality check + review payload（`src/ingestion/quality/`, `src/ingestion/review/`）。
- 實作 Vue 3 + Element Plus 前端（`src/web/`）：
  - `PdfUploadPanel.vue`：parse mode 選擇 + 進階選項 + 上傳。
  - `ParsedBlocksPane.vue`：左側 blocks 列表，依頁碼分組，active block 高亮。
  - `PdfSourceViewer.vue`：右側 pdf.js canvas renderer，bbox overlay，hover/active highlight。
  - `ParserWarnings.vue`：warnings alert 列表。
  - `PdfParsePocPage.vue`：頁面主體，雙向連動 onBlockClick ↔ onHighlightClick。
  - `previewSelection.ts`：composable reactive state。

### 驗證結果（data/target.pdf）

- 上傳 `data/target.pdf` 後 API 回傳 `PdfPreviewDocument`。
- `pageCount = 14 > 0` ✓。
- `blocks = 454`，全部 454 個 blocks 均有 page、bbox、parser、parserVersion、sourceHash ✓。
- `originalPdfUrl` 回傳 HTTP 200 + `application/pdf` ✓。
- 所有 14 頁偵測為 `native_text`（CJK 文件）✓。
- Vite build 成功，無 TypeScript 錯誤 ✓。

### 決策

- `pdf.js-extract` 回傳 `{x, y}` 直接座標，非 `transform` 矩陣，已修正。
- CJK 頁面需特別處理：每個 item 只有 1-3 個字元，不能誤判為 table-heavy。
- multipart 路由必須在 `for await` loop 內立即消耗 file stream，不能延後。
- OpenDataLoader adapter 留 placeholder，待 P1 實作。

---

## 2026-05-13 補充：開發驗證標的

### 已完成

- 確認 `data/target.pdf` 存在。
- 確認檔案資訊：PDF document, version 1.7，大小約 361 KB。
- 更新 `task_plan.md`：
  - 新增「開發驗證標的」區塊。
  - 將 `data/target.pdf` 寫入 P0.4、P0.7、P0.8 驗證項目。
  - 將固定 fixture 納入完成定義。
- 更新 `findings.md`：
  - 新增「開發 Fixture」區塊。
  - 記錄 `data/target.pdf` 的用途與限制。
  - 新增單一 fixture 過度貼合的風險。

### 決策

- `data/target.pdf` 作為 PoC 第一個固定 smoke test 標的。
- 該檔案用於驗證 upload、parse、SourceBlock normalization、PDF preview 與 bbox highlight。
- `data/target.pdf` 不代表完整測試覆蓋；後續仍需補不同 PDF 類型 fixture。
