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
          </div>
        </el-popover>
      </div>

      <div v-if="selectedFile" class="file-info">
        <el-icon><Document /></el-icon>
        <span>{{ selectedFile.name }}</span>
        <span class="file-size">{{ formatFileSize(selectedFile.size) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { Upload, Setting, Document } from "@element-plus/icons-vue";
import type { PdfParseModeHint, PdfAdvancedOptions } from "../../ingestion/types.js";

const props = defineProps<{
  isProcessing: boolean;
}>();

const emit = defineEmits<{
  parse: [file: File, mode: PdfParseModeHint, advanced: PdfAdvancedOptions];
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const parseMode = ref<PdfParseModeHint>("auto");
const advanced = ref<PdfAdvancedOptions>({
  forceNativeText: false,
  forceOcr: false,
  enableComplexTableParsing: false,
  enableSafetyFiltering: false,
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
  emit("parse", file, parseMode.value, advanced.value);

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
  width: 220px;
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

.advanced-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
