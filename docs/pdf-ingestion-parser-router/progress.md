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

## 2026-05-13 P1.1 Parser Backend Selector 規劃

### 目標

在 UI 新增 parser backend 選項（Auto / pdfjs-extract / OpenDataLoader），後端依選擇路由，SourceBlock 保留 parser provenance。

### 決策

- 採用 `@opendataloader/pdf` v2.4.3（Node.js wrapper for Java CLI，Apache-2.0）。
- Java 需求：本機已有 OpenJDK 23.0.1（`/opt/homebrew/opt/openjdk`），需設定 `JAVA_HOME`。
- ODL 輸出 JSON 格式：`[left, bottom, right, top]`（PDF points，y from bottom），與現有 `toNormalizedBbox` 函式相容。
- P1.1 先做 fast（local）mode；hybrid OCR mode 留 P1.2。
- `parserBackend = "auto"` 保留現有 detection routing 行為，不破壞相容性。

### 已完成（P1.1 執行）

- 確認 `@opendataloader/pdf` v2.4.3 可用，Java CLI 正常執行（OpenJDK 23.0.1，`/opt/homebrew/opt/openjdk`）。
- 更新 `src/ingestion/types.ts`：新增 `ParserBackend`、`OdlJsonItem`、`PreflightPageInfo`，擴充 `IngestionInput.parserBackend`。
- 實作 `src/ingestion/parsers/odlRunner.mjs`：獨立 ESM runner 作為子行程，繞過 tsx 攔截 `import.meta.url` 問題。
- 實作 `src/ingestion/parsers/opendataloaderAdapter.ts`：`spawn` 子行程呼叫 ODL → 讀 JSON（`{ kids: OdlJsonItem[] }`）→ 正規化為 `SourceBlock[]`，bbox `[left, bottom, right, top]` 透過 `toNormalizedBbox` 轉換。
- 更新 `src/ingestion/preflight/pdfjsPreflight.ts`：`PreflightResult` 加入 `pageInfos`（per-page width/height）。
- 更新 `src/ingestion/ingestPdf.ts`：`opendataloader` / `pdfjs-extract` / `auto` 三路分支。
- 更新 `src/server/routes/pdfParseRoute.ts`：接受 `parserBackend` multipart 欄位。
- 更新 `src/web/components/PdfUploadPanel.vue`：新增 backend selector（Auto 路由 / pdf.js-extract / OpenDataLoader），file info 顯示 backend badge。
- 更新 `src/web/pages/PdfParsePocPage.vue`：routing summary 顯示 OpenDataLoader tag。

### 驗證結果（data/target.pdf，OpenDataLoader backend）

- `parserBackend=opendataloader`：34 個語意化 blocks（ODL 合併段落/標題），parser = `opendataloader-default` ✓
- `parserBackend=pdfjs-extract`：454 個 blocks，parser = `pdfjs-extract` ✓
- bbox `[left, bottom, right, top]`（PDF coords）正確轉換為 normalized `{x, y, width, height}` ✓
- Playwright smoke test 14/14 通過（backend selector UI、ODL API、blocks 顯示、bbox highlight、canvas 渲染）✓

### 決策

- tsx 會攔截 node_modules 內的 `.ts` 原始碼（`import.meta.url` 變為 undefined）。解法：用 `odlRunner.mjs` 獨立子行程執行 ODL，繞過 tsx。
- ODL JSON 根結構為 `{ kids: [...] }` 而非直接陣列。
- ODL bbox `[left, bottom, right, top]` 等同於現有 `toNormalizedBbox(left, bottom, right-left, top-bottom, W, H)` 呼叫格式，直接相容。
- ODL 語意化 blocks 較少（34 vs 454），屬於設計差異；quality check 的空頁 warning 為誤報，後續可依 ODL 調整 threshold。

---

## 2026-05-13 架構調整：移除 pdf.js fallback，改為純 ODL dual-pass

### 動機

使用者確認不希望混用 ODL 與 pdf.js（會嚴重失真）；確認 ODL 本身**無 OCR 能力**（pure CPU rule-based，no GPU）。

### 根本問題分析

TFDA_QMS.pdf 的 struct tree 把 Q 問題標記為 `list item`，ODL 在兩種模式下各有盲點：

| 模式 | Q 問題（heading） | A 答案（paragraph） |
|------|------|------|
| default（無 struct tree） | ✅ 完整 | ❌ 空 list |
| `useStructTree: true` | ❌ 空 list | ✅ 完整 |

### 解法：ODL Dual-Pass Merge（純 ODL）

1. 並行執行兩個 ODL pass（`runOdlProcess` × 2）
2. Pass 1（default）：捕獲 Q 問題 heading
3. Pass 2（`useStructTree: true`）：捕獲 A 答案 paragraph
4. 以 bbox key 對齊合併：pass-1 空 block → 用 pass-2 同 bbox 替補
5. Pass-2 特有 block（bbox 不在 pass-1 中）直接追加
6. 最後以頁面 + y 排序，並做文字包含去重（text containment dedup）

### 效果（TFDA_QMS.pdf Page 1）

```
[0] heading:   標題
[1] paragraph: 日期
[2] heading:   Q1- 完整問題 ✅
[3] paragraph: Q1 尾句 ✅
[4] paragraph: A1- 完整答案（原本空 list → struct pass 補充）✅
[5] paragraph: A2- 完整段落 ✅
```

Q2 heading 仍缺失（ODL 兩個 pass 均無法提取，屬 ODL 自身限制）。

### 修改檔案

- `src/ingestion/parsers/odlRunner.mjs`：增加 `useStructTree` 參數
- `src/ingestion/parsers/opendataloaderAdapter.ts`：移除全部 pdf.js fallback 邏輯；實作 dual-pass merge + text containment dedup
- `src/ingestion/types.ts`：移除 `"odl-pdfjs-fallback"` parser variant
- `src/ingestion/ingestPdf.ts`：移除 rawPages 傳遞（不再需要）

### 決策

- ODL 沒有 OCR 能力，`hybrid` 選項是外部 docling-fast server，不是本地 OCR。
- Q2 缺失為 ODL 的 struct tree 解析限制，無法在純 ODL 框架內解決。
- 51 blocks（vs 之前 80+ 含重複）；target.pdf 不受影響（36 blocks）。

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

---

## 2026-05-13 P1.2：eSearch-OCR 作為 page-level OCR repair（計畫落地）

### 架構（與計畫一致）

- **OpenDataLoader**：主解析器；dual-pass merge 不變。
- **pdf.js-extract**：僅 **preflight**（`PageTextStats`、`pageInfos`）；**不作為**與 ODL 並行的正文來源（`parserBackend=pdfjs-extract` 時仍可走 pdfjs adapter，屬使用者明選之路徑）。
- **eSearch-OCR**：可選 **page-level repair**；整頁光柵 **Poppler `pdftoppm`**；輸出統一為 **`SourceBlock`**（`parser: esearch-ocr-repair`，`extractionMode: ocr`）。
- **Rule Extractor 契約**：僅依賴 **`SourceBlock[]`**（見 README／型別註解）；不依賴 raw ODL JSON。

### 已完成

| 項目 | 說明 |
|---|---|
| **Trigger 分類** | `scan_or_low_text`（preflight 字數 &lt; 20 或 `hasExtractableText` false）與 `structural_hole`（merged ODL 非 skip 類型空 content；`table` 空 `rows`）以 **OR** 合併；`provenance.repairTriggers` 紀錄 |
| **Raw ODL 保留** | `runOpendataloaderAdapter` 回傳 **`mergedOdlItems`**，在 `itemsToBlocks` 捨棄前供 structural hole 判定 |
| **`SourceBlock.provenance`** | `parserId`、`modelLabel`、`raster`（Poppler DPI／像素／頁面 points）、`fallbackReasons`、`repairTriggers` |
| **Poppler 光柵** | `src/ingestion/ocr/popplerRasterize.ts` |
| **座標映射** | OCR quad（像素、原點左上）→ PDF points → `toNormalizedBbox`（`bboxRaster.ts`） |
| **eSearch 管線** | `esearchOcrRepair.ts`：`@napi-rs/canvas` + `setOCREnv`；v5 det/rec（rec `optimize.space: false`）；可選 `docCls`；**preprocess**（灰階+normalize）→ **reraster 較高 DPI** → **fallback PP-OCRv4 doc rec**（若 ONNX 檔存在） |
| **合併去重** | `mergeOdlAndOcr.ts` + 共用 `textOverlap.ts`，再 `dedupeBlocks` |
| **併發** | `p-limit`，環境變數 `OCR_REPAIR_MAX_PAGES_IN_FLIGHT`（預設 2） |
| **模型解析** | `modelPaths.ts` + `ESEARCH_OCR_MODEL_DIR` 與可選覆寫路徑（README 已列） |
| **ingestPdf** | ODL/auto 路徑在 `enableOcrRepair` 為真且子開關啟用時呼叫 repair layer |
| **UI** | `PdfUploadPanel` 進階：`enableOcrRepair`、`repairOnScanOrLowText`、`repairOnStructuralHole`（預設關） |
| **文件** | README：pipeline、環境變數、Tech Stack（ODL／eSearch／Poppler） |

### 驗證（截至本條目撰寫時）

- `enableOcrRepair: false` + `target.pdf` + OpenDataLoader：block 數與行為與改版前 smoke 一致；ODL blocks 帶 **`provenance.parserId`**。
- **`npm run typecheck`**、`tsconfig.server.json`：**通過**（含 Vue `*.vue` shim）。

### 未完成 / 後續（P2 或計畫未列之補強）

| 項目 | 說明 |
|---|---|
| **自動化測試** | Trigger 矩陣（僅 scan、僅 hole、兩者兼具）尚無獨立 unit / integration fixture |
| **OCR repair E2E** | 需在具 **`ESEARCH_OCR_MODEL_DIR` + Poppler** 的環境驗證完整 repair 輸出與 provenance |
| **每頁嘗試次數上限** | 尚有「每頁最多 N 次 raster/OCR attempt」之產品性上限未硬性寫死 |
| **Poppler 缺省 degradation** | 目前以 `warnings` 回報失敗頁；可再加統一錯誤碼／metrics |
| **`OcrRepairAttempt` 結構化日誌** | 計畫中的 `rasterPreset`／`preprocessPreset` 列舉型尚未獨立成單一型別檔 |
| **P1 pdfjs-dist + canvas 光柵備援** | 仍為計畫中的 **P1**；程式碼僅 Poppler |
| **子進程／worker_pool OCR** | 僅同進程 `p-limit`；未實作 ODL runner 類型之子進程 ORT pool |
| **UI 暴露 structural hole 列表** | 計畫標 P2：除錯用「空洞列表」尚未做 |
| **TFDA／掃描 PDF** | 自動化迴歸仍依賴手動／本機環境 |

### 決策（本階段）

- Repair **預設關閉**，避免無模型環境誤開造成噪音或逾時。
- 與 ODL 並行競爭 CPU：實作上 **ODL 完成後**再跑需 repair 的頁（非與 dual-pass JVM 交錯）。
- ONNX / 字典 **不入 repo**，僅環境變數與 README 指向 release。
