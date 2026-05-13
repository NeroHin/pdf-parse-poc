<template>
  <div class="upload-panel">
    <div class="upload-toolbar">
      <div class="toolbar-row">
        <el-select
          v-model="parseMode"
          class="mode-select"
          :disabled="isProcessing"
        >
          <el-option label="自動判斷（建議）" value="auto" />
          <el-option label="原生 PDF / 可選取文字" value="native_text" />
          <el-option label="掃描 PDF / 圖片型 PDF" value="scanned_image" />
          <el-option label="混合 PDF / 不確定" value="mixed_or_unknown" />
        </el-select>

        <el-select
          v-model="parserBackend"
          class="backend-select"
          :disabled="isProcessing"
        >
          <template #prefix>
            <el-icon><Connection /></el-icon>
          </template>
          <el-option label="Auto（ODL 主力）" value="auto">
            <span>Auto（ODL 主力）</span>
            <span class="option-desc">OpenDataLoader dual-pass</span>
          </el-option>
          <el-option label="pdf.js-extract" value="pdfjs-extract">
            <span>pdf.js-extract</span>
            <span class="option-desc">快速原生文字解析</span>
          </el-option>
          <el-option label="OpenDataLoader" value="opendataloader">
            <span>OpenDataLoader</span>
            <el-tag size="small" type="success" class="option-tag">#1 benchmark</el-tag>
            <span class="option-desc">精準排版 + 表格 + bbox</span>
          </el-option>
        </el-select>

        <el-button
          type="primary"
          :icon="Upload"
          :loading="isProcessing"
          @click="triggerFileInput"
        >
          {{ isProcessing ? "解析中..." : "上傳 PDF" }}
        </el-button>

        <input
          ref="fileInputRef"
          type="file"
          accept="application/pdf"
          class="hidden-input"
          @change="onFileSelected"
        />

        <el-popover
          placement="bottom"
          title="進階選項"
          :width="280"
          trigger="click"
        >
          <template #reference>
            <el-button :icon="Setting" :disabled="isProcessing">進階</el-button>
          </template>
          <div class="advanced-options">
            <el-checkbox v-model="advanced.forceNativeText">強制使用原生文字解析</el-checkbox>
            <el-checkbox v-model="advanced.forceOcr">強制使用 OCR / 掃描解析</el-checkbox>
            <el-checkbox v-model="advanced.enableComplexTableParsing">啟用複雜表格解析</el-checkbox>
            <el-checkbox v-model="advanced.enableSafetyFiltering">啟用安全過濾 hidden/off-page text</el-checkbox>
            <el-divider />
            <div class="advanced-hint">Page-level OCR repair（OpenDataLoader 仍為主解析；需 Poppler + ONNX 模型）</div>
            <el-checkbox v-model="advanced.enableOcrRepair">啟用 eSearch-OCR repair</el-checkbox>
            <el-checkbox v-model="advanced.repairOnScanOrLowText" :disabled="!advanced.enableOcrRepair">
              觸發：掃描／低文字量（preflight）
            </el-checkbox>
            <el-checkbox v-model="advanced.repairOnStructuralHole" :disabled="!advanced.enableOcrRepair">
              觸發：ODL 結構空洞（空 block／空表格）
            </el-checkbox>
          </div>
        </el-popover>
      </div>

      <div v-if="selectedFile" class="file-info">
        <el-icon><Document /></el-icon>
        <span>{{ selectedFile.name }}</span>
        <span class="file-size">{{ formatFileSize(selectedFile.size) }}</span>
        <el-tag size="small" :type="backendTagType" class="backend-badge">
          {{ backendLabel }}
        </el-tag>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { Upload, Setting, Document, Connection } from "@element-plus/icons-vue";
import type { PdfParseModeHint, PdfAdvancedOptions, ParserBackend } from "../../ingestion/types.js";

const props = defineProps<{
  isProcessing: boolean;
}>();

const emit = defineEmits<{
  parse: [file: File, mode: PdfParseModeHint, backend: ParserBackend, advanced: PdfAdvancedOptions];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const parseMode = ref<PdfParseModeHint>("auto");
const parserBackend = ref<ParserBackend>("opendataloader");
const advanced = ref<PdfAdvancedOptions>({
  forceNativeText: false,
  forceOcr: false,
  enableComplexTableParsing: false,
  enableSafetyFiltering: false,
  enableOcrRepair: false,
  repairOnScanOrLowText: false,
  repairOnStructuralHole: false,
});

const backendLabel = computed(() => {
  const map: Record<ParserBackend, string> = {
    auto: "Auto",
    "pdfjs-extract": "pdf.js-extract",
    opendataloader: "OpenDataLoader",
  };
  return map[parserBackend.value];
});

const backendTagType = computed((): "success" | "warning" | "info" => {
  if (parserBackend.value === "opendataloader") return "success";
  if (parserBackend.value === "pdfjs-extract") return "info";
  return "warning";
});

function triggerFileInput() {
  fileInputRef.value?.click();
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    ElMessage.error("請上傳 PDF 檔案");
    return;
  }

  selectedFile.value = file;
  emit("parse", file, parseMode.value, parserBackend.value, advanced.value);

  // Reset input so same file can be re-uploaded
  input.value = "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.upload-panel {
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mode-select {
  width: 200px;
}

.backend-select {
  width: 180px;
}

.option-desc {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-left: 6px;
}

.option-tag {
  margin-left: 4px;
}

.hidden-input {
  display: none;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.file-size {
  color: var(--el-text-color-placeholder);
}

.backend-badge {
  margin-left: 4px;
}

.advanced-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.advanced-hint {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  line-height: 1.4;
}
</style>
