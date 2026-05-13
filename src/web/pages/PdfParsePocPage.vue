<template>
  <div class="poc-page">
    <!-- Top toolbar -->
    <PdfUploadPanel
      :is-processing="isProcessing"
      @parse="onParse"
    />

    <!-- Routing summary -->
    <div v-if="routingSummary" class="routing-summary">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ routingSummary }}</span>
      <el-tag v-if="activeBackendLabel" size="small" :type="activeBackendTagType" class="backend-tag">
        {{ activeBackendLabel }}
      </el-tag>
    </div>

    <!-- Warnings -->
    <ParserWarnings v-if="state.previewDocument.value" :warnings="state.previewDocument.value.warnings" />

    <!-- Error -->
    <el-alert
      v-if="state.status.value === 'error'"
      :title="state.errorMessage.value ?? '發生未知錯誤'"
      type="error"
      :closable="false"
      show-icon
      class="error-alert"
    />

    <!-- Main two-pane layout -->
    <div class="main-content">
      <!-- Left: parsed blocks -->
      <div class="left-pane">
        <div class="pane-header">
          <span class="pane-title">解析結果</span>
          <div v-if="state.previewDocument.value" class="pane-actions">
            <span class="pane-meta">
              {{ state.previewDocument.value.blocks.length }} 個 blocks，
              {{ state.previewDocument.value.pageCount }} 頁
            </span>
            <el-button
              size="small"
              type="primary"
              plain
              @click="onExportAllText"
            >
              匯出全部文字
            </el-button>
            <el-button
              size="small"
              plain
              @click="onDownloadTextFile"
            >
              下載 .txt
            </el-button>
          </div>
        </div>
        <ParsedBlocksPane
          ref="parsedBlocksPaneRef"
          :blocks="state.previewDocument.value?.blocks ?? []"
          :detections="state.previewDocument.value?.detections ?? []"
          :active-block-id="state.activeBlockId.value"
          @block-click="onBlockClick"
          @block-hover="onBlockHover"
          @block-leave="onBlockLeave"
          @page-click="onPageClick"
          @copy-page="onCopyPage"
        />
      </div>

      <!-- Right: original PDF -->
      <div class="right-pane">
        <div class="pane-header">
          <span class="pane-title">原始文件</span>
          <span v-if="state.previewDocument.value" class="pane-meta">
            {{ state.previewDocument.value.fileName }}
          </span>
        </div>
        <PdfSourceViewer
          ref="pdfViewerRef"
          :pdf-url="state.previewDocument.value?.originalPdfUrl ?? null"
          :blocks="state.previewDocument.value?.blocks ?? []"
          :active-block-id="state.activeBlockId.value"
          :hover-block-id="hoverBlockId"
          @highlight-click="onHighlightClick"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import PdfUploadPanel from "../components/PdfUploadPanel.vue";
import ParsedBlocksPane from "../components/ParsedBlocksPane.vue";
import PdfSourceViewer from "../components/PdfSourceViewer.vue";
import ParserWarnings from "../components/ParserWarnings.vue";
import { usePreviewState } from "../state/previewSelection.js";
import type { PdfParseModeHint, PdfAdvancedOptions, SourceBlock } from "../../ingestion/types.js";

const state = usePreviewState();
const parsedBlocksPaneRef = ref<InstanceType<typeof ParsedBlocksPane> | null>(null);
const pdfViewerRef = ref<InstanceType<typeof PdfSourceViewer> | null>(null);
const hoverBlockId = ref<string | null>(null);

const isProcessing = computed(
  () => state.status.value === "uploading" || state.status.value === "parsing"
);

const activeBackendLabel = computed(() => {
  const doc = state.previewDocument.value;
  if (!doc || doc.blocks.length === 0) return null;
  const parsers = new Set(doc.blocks.map((b) => b.parser));
  const hasOdl = parsers.has("opendataloader-default");
  const hasRepair = parsers.has("esearch-ocr-repair");
  if (hasOdl && hasRepair) return "OpenDataLoader + eSearch-OCR";
  if (hasRepair && !hasOdl) return "eSearch-OCR";
  if (hasOdl || [...parsers].some((p) => p.startsWith("opendataloader"))) return "OpenDataLoader";
  return null;
});

const activeBackendTagType = computed((): "success" | "info" => {
  if (activeBackendLabel.value === "OpenDataLoader") return "success";
  return "info";
});

const routingSummary = computed(() => {
  const doc = state.previewDocument.value;
  if (!doc) return null;
  const detections = doc.detections;
  if (detections.length === 0) return null;

  const groups: string[] = [];
  const native = detections.filter((d) => d.layoutClass === "native_text").map((d) => d.page);
  const scanned = detections.filter((d) => d.layoutClass === "scanned_image").map((d) => d.page);
  const complex = detections.filter((d) => d.layoutClass === "complex_layout").map((d) => d.page);
  const suspicious = detections.filter((d) => d.layoutClass === "suspicious").map((d) => d.page);

  if (native.length > 0) groups.push(`第 ${formatPages(native)} 頁為原生文字`);
  if (scanned.length > 0) groups.push(`第 ${formatPages(scanned)} 頁疑似掃描影像`);
  if (complex.length > 0) groups.push(`第 ${formatPages(complex)} 頁為複雜排版`);
  if (suspicious.length > 0) groups.push(`第 ${formatPages(suspicious)} 頁含可疑內容`);

  return groups.join("，") + "。";
});

function formatPages(pages: number[]): string {
  if (pages.length <= 5) return pages.join("、");
  return `${pages[0]}-${pages[pages.length - 1]}`;
}

function blocksToText(blocks: SourceBlock[]): string {
  return blocks
    .slice()
    .sort((a, b) => a.page - b.page || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n");
}

async function copyText(text: string, successMessage: string) {
  if (!text.trim()) {
    ElMessage.warning("沒有可複製的文字");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(successMessage);
  } catch {
    ElMessage.error("複製失敗，瀏覽器未允許剪貼簿權限");
  }
}

async function onCopyPage(pageNum: number) {
  const blocks = state.previewDocument.value?.blocks.filter((b) => b.page === pageNum) ?? [];
  await copyText(blocksToText(blocks), `已複製第 ${pageNum} 頁文字`);
}

async function onExportAllText() {
  await copyText(buildAllText(), "已複製全部文字");
}

function buildAllText(): string {
  const blocks = state.previewDocument.value?.blocks ?? [];
  const grouped = new Map<number, SourceBlock[]>();
  for (const block of blocks) {
    const pageBlocks = grouped.get(block.page) ?? [];
    pageBlocks.push(block);
    grouped.set(block.page, pageBlocks);
  }
  const text = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, pageBlocks]) => `# 第 ${page} 頁\n${blocksToText(pageBlocks)}`)
    .join("\n\n");
  return text;
}

function onDownloadTextFile() {
  const text = buildAllText();
  if (!text.trim()) {
    ElMessage.warning("沒有可匯出的文字");
    return;
  }
  const baseName = (state.previewDocument.value?.fileName ?? "pdf-parse-result").replace(/\.pdf$/i, "");
  const fileName = `${baseName}.txt`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  ElMessage.success("已產生文字檔");
}

async function onParse(
  file: File,
  mode: PdfParseModeHint,
  advanced: PdfAdvancedOptions
) {
  state.setStatus("uploading");
  state.clearError();

  const formData = new FormData();
  formData.append("file", file);
  formData.append("parseMode", mode);
  formData.append("advancedOptions", JSON.stringify(advanced));

  try {
    state.setStatus("parsing");

    const response = await fetch("/api/pdf/parse", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Unknown error" }));
      const message = err.detail ? `${err.error ?? `HTTP ${response.status}`}: ${err.detail}` : err.error;
      throw new Error(message ?? `HTTP ${response.status}`);
    }

    const doc = await response.json();
    state.setPreviewDocument(doc);
    state.setStatus("ready");
    ElMessage.success(`解析完成，共 ${doc.blocks.length} 個 blocks`);
  } catch (err) {
    state.setError(String(err));
    ElMessage.error("PDF 解析失敗");
  }
}

function onBlockClick(block: SourceBlock) {
  state.selectBlock(block);
}

function onBlockHover(block: SourceBlock) {
  hoverBlockId.value = block.id;
}

function onBlockLeave() {
  hoverBlockId.value = null;
}

function onPageClick(pageNum: number) {
  pdfViewerRef.value?.scrollToPage(pageNum);
}

function onHighlightClick(blockId: string) {
  const blocks = state.previewDocument.value?.blocks ?? [];
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return;

  state.selectBlock(block);
  parsedBlocksPaneRef.value?.scrollToBlock(blockId);
}
</script>

<style scoped>
.poc-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.routing-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-color-info-light-9);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.backend-tag {
  margin-left: auto;
}

.error-alert {
  margin: 8px 16px;
  border-radius: 4px;
}

.main-content {
  flex: 1;
  display: grid;
  grid-template-columns: 380px 1fr;
  overflow: hidden;
  border-top: 1px solid var(--el-border-color);
}

.left-pane,
.right-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.left-pane {
  border-right: 1px solid var(--el-border-color);
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--el-bg-color-page);
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.pane-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pane-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.pane-meta {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
