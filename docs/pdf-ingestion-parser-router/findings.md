# PDF Ingestion Parser Router 發現紀錄

## 目前狀態

- 專案根目錄：`/Users/nero/dev/pdf-parse-poc`
- 後端 parser 已收斂為 OpenDataLoader dual-pass。
- Alternative backend parser path 已移除。
- 前端 `pdfjs-dist` 仍保留，僅作 PDF viewer canvas rendering。
- 規則產生與草稿工作流已移出目前 PoC scope。

## 架構判斷

### 1. ODL-only 較符合目前 PoC

混用 ODL 與 backend pdf.js 會讓 reading order、bbox、paragraph grouping 失真。固定 ODL dual-pass 可以讓 `SourceBlock[]` provenance 更單純，也降低 parser selection 的 UI/後端分支。

### 2. Poppler 是 OCR repair 的必要外部依賴

`pdfinfo` 負責 page count/page size；`pdftoppm` 負責 OCR 前整頁 raster。若缺 Poppler，OCR repair 不應假裝可用，應在 `ocr:check-env` 或 runtime warnings 中明確失敗。

### 3. OCR repair 應隔離在 child process

ONNX runtime 與影像處理可能吃 CPU/記憶體；用 bounded child-process workers 能隔離 page-level repair，並用 `OCR_REPAIR_MAX_PAGES_IN_FLIGHT` 控制併發。

### 4. 目前測試缺口

- 缺掃描 PDF fixture。
- 缺 OCR repair E2E。
- 缺 trigger matrix 測試：scan-only、hole-only、scan + hole。
- 缺 worker failure/degradation 測試。

## 本機環境發現

| 項目 | 狀態 |
|---|---|
| Node.js | `v20.20.2` |
| Poppler | `/opt/homebrew/bin/pdfinfo`, `/opt/homebrew/bin/pdftoppm` |
| OCR model dir | `models/esearch-ocr` |
| OCR model files | eSearch-OCR 3.0.0 PP-OCRv2 ONNX + `ppocr_keys_v1.txt` |
| OCR v5 model dir | `models/esearch-ocr-v5` |
| OCR v5 model files | eSearch-OCR 4.0.0 `ppocr_v5_server.zip` |

## 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| OCR 模型不進 repo | 新環境需額外下載 | `npm run ocr:download-models` |
| Poppler 不在 PATH | OCR/preflight 失敗 | 支援 `/opt/homebrew/bin/*` 與 `PDFINFO_PATH` / `PDFTOPPM_PATH` |
| 掃描 PDF fixture 尚未補 | OCR E2E 未完整證明 | 下一步補 fixture 與 integration test |
| ODL 對特定 struct tree 仍有盲點 | 部分文字可能缺失 | structural-hole trigger + OCR repair |
