# PDF Ingestion Parser Router 發現紀錄

## 目前專案狀態

- 專案根目錄：`/Users/nero/dev/pdf-parse-poc`
- 目前只有 `README.md`，描述為 `NodeJS PDF parse feature PoC`。
- 尚未有 `package.json`、`src/`、測試框架或既有 ingestion 實作。
- 因此本次先建立設計與執行計畫，不綁定不存在的程式碼邊界。

## 需求摘要

- UI 允許使用者指定 PDF 類型，但預設為自動判斷。
- 後端不能完全相信使用者選項，因為企業 PDF 常見混合頁面、爛文字層、掃描附件、hidden/off-page text。
- Parser decision 應採：
  - User hint = routing signal
  - System detection = primary decision
  - Parser result quality = fallback trigger
- Preflight 使用 `pdf.js-extract` 做快速文字與座標掃描。
- 掃描、複雜表格、多欄 reading order、hidden/off-page/prompt-injection safety、production fallback 交給 OpenDataLoader 類路徑。
- 上層 rule extraction / review UI 只吃 `SourceBlock[]`。
- 目前使用者想先做簡單 PoC：單一頁面上傳 PDF，完成 parsing 後左側顯示 parsing 結果，右側顯示原始 PDF，並支援 parsing block 與原檔 bbox highlight 的雙向連動。
- PoC 的第一個成功標準不是 rule extraction，而是證明 parser output 能被人類用原文 PDF 對照審查。
- Tech stack 已指定：本機 Node.js、Fastify、Vue.js 3、Element Plus、Vite。
- 目前不要加入任何 DB；PoC storage 只使用本機暫存檔與 process memory。
- 開發時可使用 `data/target.pdf` 作為主要驗證標的。

## Tech Stack 發現


| 項目              | 決定                               |
| --------------- | -------------------------------- |
| 本機 Node.js 版本   | `v20.20.2`                       |
| Backend         | Fastify                          |
| Frontend        | Vue.js 3                         |
| UI library      | Element Plus                     |
| Build tool      | Vite                             |
| DB              | 不使用                              |
| PoC persistence | local temp files + in-memory Map |


## No-DB 邊界

- 原始 PDF 可存到本機暫存目錄，透過 Fastify route 回傳給前端 PDF viewer。
- `PdfPreviewDocument` 可存在 server process memory，例如 `Map<documentId, PdfPreviewDocument>`。
- server restart 後，preview document index 可以失效；這符合 PoC，不應包裝成 production behavior。
- 暫存檔需要 cleanup policy，例如啟動時清理舊檔或以 TTL 清除。
- 不處理多節點同步、長期 audit、使用者歷史紀錄、文件版本管理。

## 開發 Fixture


| 項目    | 值                         |
| ----- | ------------------------- |
| 主要驗證檔 | `data/target.pdf`         |
| 檔案類型  | PDF document, version 1.7 |
| 檔案大小  | 約 361 KB                  |


使用方式：

- Fastify upload API 的本機驗證檔。
- `pdf.js-extract` preflight 與 page-level detection 的第一個固定輸入。
- `SourceBlock[]` normalization 的 regression fixture。
- Vue preview 頁面左右連動與 bbox highlight 的 browser smoke test 標的。

注意：

- `data/target.pdf` 只能代表目前 PoC 的第一個固定樣本，不等於完整涵蓋原生、掃描、混合、表格與 suspicious PDF。
- 後續仍需要補不同 PDF 類型的 fixture，避免 detection/routing 只對單一樣本調校。

## 架構判斷

### 1. Page-level detection 是必要設計

整份文件單一分類會漏掉企業文件中的掃描附件、影像附錄、表格頁與可疑頁。第一版即應保留 page-level detection 結果，即使 parser execution 先用 contiguous page groups 批次處理。

### 2. SourceBlock 是真正的穩定合約

混合 parser 的最大風險不是能不能呼叫不同工具，而是 output format、bbox coordinate、reading order、confidence、warnings 與 provenance 不一致。`SourceBlock` 必須成為 rule extraction 前唯一入口。

### 3. bbox normalization 是 preview 的高風險點

不同 parser 可能使用不同座標系：

- 原點左上或左下
- PDF points 或 normalized ratio
- block bbox 或 text item bbox

第一版要先定義 canonical coordinate system，否則 source preview highlight 會不可信。

### 4. OCR 與 native text layer 需要 dedup

混合 PDF 可能同時有掃描影像與隱藏文字層。若 native text 與 OCR 都保留，rule candidate 可能重複或互相污染。建議第一版用：

- `sourceHash`
- `page`
- bbox overlap threshold
- normalized text similarity

做 dedup。

### 5. Rule candidate 必須保留 provenance

B2B governance 場景需要能回答「這條規則從哪一頁、哪個 bbox、哪個 parser、哪個 parser version、哪段 source text 產生」。否則後續 audit 與人工審核很難成立。

### 6. Preview UI 應先驗證 SourceBlock 可對照性

若解析結果無法穩定對映回 PDF 原檔，後續 rule candidate extraction 即使能產生文字，也缺乏可審查性。PoC 應優先驗證：

- 每個 `SourceBlock` 是否有可用 page 與 bbox。
- 點選 parsed block 是否能 scroll 到原始 PDF 對應頁。
- highlight 是否與肉眼看到的文字區塊對齊。
- PDF highlight 是否能回跳到左側 parsed block。
- 無 bbox 或低 confidence block 是否能清楚標示，而不是假裝可定位。

### 7. 第一版可以把 OpenDataLoader 延後到 adapter placeholder

目前 repo 尚未有 Node.js 專案骨架。若 PoC 目標是快速展示 upload/parse/preview/連動，第一版可先完成 `pdf.js-extract` native path、page detection、SourceBlock normalization 與 preview highlight。OpenDataLoader adapter 可保留 interface 與 routing warning，實際接入放到 P1，避免 PoC 被 OCR/runtime 部署複雜度拖住。

### 8. Fastify + Vue 3/Vite 是合理的 PoC 切法

Fastify 負責 multipart upload、原檔下載、parser orchestration 與 preview document memory store。Vue 3 負責單頁互動，Element Plus 提供上傳、表單、alert、loading 與 pane UI。Vite 提供快速開發與前端 build。此切法和 no-DB scope 相容，能先把 parser/preview loop 做出來。

## Detection 指標建議


| 指標                       | 用途                                                 |
| ------------------------ | -------------------------------------------------- |
| `textItemCount`          | 判斷文字層密度與 table-like item fragmentation             |
| `charCount`              | 掃描頁 / 空文字層初步判斷                                     |
| `cjkCharRatio`           | 中文文件是否抽出合理文字                                       |
| `whitespaceRatio`        | 亂碼、碎片化、不可見文字風險                                     |
| `avgFontSize`            | tiny hidden text / footnote / header/footer signal |
| `bboxCoverageRatio`      | 文字層覆蓋頁面程度                                          |
| repeated x/y coordinates | 表格與欄位對齊 signal                                     |
| off-page bbox            | hidden/off-page text 風險                            |


## 初始 routing 規則


| 偵測結果                                          | Parser                     |
| --------------------------------------------- | -------------------------- |
| native text + simple layout                   | `pdf.js-extract`           |
| native text + table-heavy / multi-column      | OpenDataLoader default     |
| scanned / low extractable text                | OpenDataLoader hybrid OCR  |
| suspicious / hidden / off-page / garbled text | OpenDataLoader safety path |


## MVP UI 行為

- 預設：`自動判斷（建議）`
- 可選：
  - `原生 PDF / 可選取文字`
  - `掃描 PDF / 圖片型 PDF`
  - `混合 PDF / 不確定`
- 進階選項：
  - 強制使用原生文字解析
  - 強制使用 OCR / 掃描解析
  - 啟用複雜表格解析
  - 啟用安全過濾 hidden/off-page text
- Review UI 應顯示系統判斷，例如：`第 1-10 頁為原生文字，第 11-14 頁疑似掃描附件，已使用 OCR 解析。`

## PoC Preview 行為

### 版面

- 頁面頂部：PDF upload、解析模式、進階選項、解析按鈕、狀態訊息。
- 左側：解析結果，以 page group 顯示 `SourceBlock[]`。
- 右側：原始 PDF viewer，以 page 為單位 rendering，並在頁面上疊加 bbox highlight layer。

### 左側 parsing 結果

- 每個 block 顯示：
  - block type
  - page number
  - parser / extraction mode
  - confidence
  - warnings
  - text preview
- block click 後更新 active selection。
- active block 需有明確視覺狀態。

### 右側原檔 preview

- PDF 原檔應使用瀏覽器端 PDF renderer 或 `<iframe>` 加 overlay；若要 bbox 精準對齊，較建議使用 pdf.js viewer/canvas，自行控制 scale 與 overlay coordinate。
- highlight overlay 必須使用 normalized bbox 或已轉換後的 viewer coordinate。
- PDF page render scale 改變時，highlight 位置要重新計算。

### 雙向連動


| 使用者行為                | 系統行為                            |
| -------------------- | ------------------------------- |
| 點左側 SourceBlock      | 右側 scroll 到 page，highlight bbox |
| hover 左側 SourceBlock | 右側顯示淡色 bbox preview             |
| 點右側 highlight        | 左側 scroll 到對應 SourceBlock       |
| block 無 bbox         | 左側顯示 warning，右側不做定位             |
| parser warning       | 左側 page group 與頂部 warning 區顯示   |


## PoC API 建議


| Method | Path                            | 用途                             |
| ------ | ------------------------------- | ------------------------------ |
| `POST` | `/api/pdf/parse`                | 上傳 PDF，回傳 `PdfPreviewDocument` |
| `GET`  | `/api/pdf/:documentId/original` | 取得原始 PDF 檔案                    |


`POST /api/pdf/parse` 回傳重點：

- `documentId`
- `fileName`
- `pageCount`
- `originalPdfUrl`
- `detections`
- `blocks`
- `warnings`

## PoC Package 建議

Backend dependencies：

- `fastify`
- `@fastify/multipart`
- `@fastify/static`
- `pdf.js-extract`

Frontend dependencies：

- `vue`
- `@vitejs/plugin-vue`
- `vite`
- `element-plus`
- `pdfjs-dist`

開發時可用 Vite proxy 將 `/api` 指向 Fastify，避免前端直接處理 CORS。

## 風險與待驗證事項


| 風險                                     | 影響                        | 緩解                                            |
| -------------------------------------- | ------------------------- | --------------------------------------------- |
| OpenDataLoader 部署成本不明                  | 影響 PoC 可執行性               | 先以 adapter interface 包裝，實作可替換                 |
| bbox coordinate 不一致                    | preview highlight 錯位      | 建立 bbox normalization unit tests              |
| pdf.js-extract 對中文 layout 統計不足         | detection 誤判              | 建立中文 fixture 與 CJK ratio 測試                   |
| OCR 錯字污染 rule extraction               | 候選規則品質下降                  | confidence、warnings、human approval gate       |
| hidden/off-page text 被抽入規則             | 安全與治理風險                   | suspicious route + safety filtering + warning |
| table-heavy 頁面被拆碎                      | rule extraction 失真        | table signal 觸發 OpenDataLoader default/hybrid |
| PDF viewer scale 與 bbox coordinate 不一致 | highlight 錯位，PoC 不可信      | 使用 normalized bbox，render 後依 page viewport 轉換 |
| 左右 pane scroll 狀態互相干擾                  | 使用者難以確認對應關係               | click 才做強制 scroll，hover 只做 preview            |
| 使用 `<iframe>` 顯示 PDF 難以精準 overlay      | bbox 連動受限                 | PoC 若重視對齊，採 pdf.js canvas renderer            |
| 大 PDF 一次 render 全頁過慢                   | Preview 卡頓                | MVP 可限制頁數或 lazy render visible pages          |
| 不使用 DB 導致 server restart 後資料遺失         | preview session 不可恢復      | 文件與 UI 明確標示為 PoC 行為，之後再補 persistence          |
| in-memory Map 長時間累積                    | 本機記憶體上升                   | 增加 TTL cleanup 與手動清理 API 或啟動清理                |
| 本機暫存檔未清理                               | 磁碟空間增加                    | upload store 實作 cleanup policy                |
| 只用 `data/target.pdf` 驗證                | parser routing 可能過度貼合單一文件 | P0 用於 smoke test，P1 補原生/掃描/混合/表格 fixture      |


## 不在第一版範圍

- 完整商用 PDF parser vendor comparison。
- 訓練或微調 OCR model。
- 直接產出正式 RuleSpec 並自動啟用。
- 複雜人工標註平台。
- 多租戶權限、稽核報表與長期 storage policy。
- 完整 PDF annotation editor。
- 大規模文件佇列、背景任務與長時間 OCR job 管理。
- DB schema、migration、ORM 與 production persistence。

