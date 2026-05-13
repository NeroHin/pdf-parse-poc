<template>
  <div class="parsed-blocks-pane">
    <div v-if="blocks.length === 0" class="empty-state">
      <el-empty description="尚無解析結果" :image-size="80" />
    </div>

    <el-scrollbar v-else ref="scrollbarRef" class="blocks-scrollbar">
      <div
        v-for="pageNum in pageNumbers"
        :key="pageNum"
        :data-page="pageNum"
        class="page-group"
      >
        <div class="page-header">
          <span class="page-label">第 {{ pageNum }} 頁</span>
          <el-tag
            v-if="getPageDetection(pageNum)"
            :type="getDetectionTagType(pageNum)"
            size="small"
            class="detection-tag"
          >
            {{ getDetectionLabel(pageNum) }}
          </el-tag>
        </div>

        <div
          v-for="block in getPageBlocks(pageNum)"
          :key="block.id"
          :ref="(el) => setBlockRef(block.id, el as HTMLElement | null)"
          :class="['block-item', { active: activeBlockId === block.id }]"
          @click="onBlockClick(block)"
          @mouseenter="onBlockHover(block)"
          @mouseleave="onBlockLeave"
        >
          <div class="block-header">
            <el-tag :type="blockTypeTagType(block.blockType)" size="small">
              {{ blockTypeLabel(block.blockType) }}
            </el-tag>
            <span class="block-parser">{{ block.parser }}</span>
            <el-tag
              v-if="block.confidence < 0.6"
              type="warning"
              size="small"
              class="confidence-tag"
            >
              低信心 {{ (block.confidence * 100).toFixed(0) }}%
            </el-tag>
          </div>

          <div class="block-text">{{ truncateText(block.text, 200) }}</div>

          <div v-if="block.warnings.length > 0" class="block-warnings">
            <el-icon color="var(--el-color-warning)"><Warning /></el-icon>
            <span v-for="(w, i) in block.warnings" :key="i" class="warning-text">{{ w }}</span>
          </div>

          <div v-if="!hasBbox(block)" class="no-bbox-warning">
            <el-icon><InfoFilled /></el-icon> 無可定位座標
          </div>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { Warning, InfoFilled } from "@element-plus/icons-vue";
import type { SourceBlock, PageDetection } from "../../ingestion/types.js";

const props = defineProps<{
  blocks: SourceBlock[];
  detections: PageDetection[];
  activeBlockId: string | null;
}>();

const emit = defineEmits<{
  blockClick: [block: SourceBlock];
  blockHover: [block: SourceBlock];
  blockLeave: [];
}>();

const scrollbarRef = ref<{ wrapRef: HTMLElement } | null>(null);
const blockRefs = new Map<string, HTMLElement>();

function setBlockRef(id: string, el: HTMLElement | null) {
  if (el) blockRefs.set(id, el);
  else blockRefs.delete(id);
}

const pageNumbers = computed(() => {
  const pages = new Set(props.blocks.map((b) => b.page));
  return [...pages].sort((a, b) => a - b);
});

function getPageBlocks(page: number) {
  return props.blocks.filter((b) => b.page === page);
}

function getPageDetection(page: number) {
  return props.detections.find((d) => d.page === page) ?? null;
}

function getDetectionLabel(page: number): string {
  const d = getPageDetection(page);
  if (!d) return "";
  const labels: Record<string, string> = {
    native_text: "原生文字",
    scanned_image: "掃描影像",
    complex_layout: "複雜排版",
    suspicious: "可疑內容",
    mixed: "混合",
  };
  return labels[d.layoutClass] ?? d.layoutClass;
}

function getDetectionTagType(
  page: number
): "success" | "warning" | "danger" | "info" | "" {
  const d = getPageDetection(page);
  if (!d) return "";
  if (d.layoutClass === "suspicious") return "danger";
  if (d.layoutClass === "scanned_image") return "warning";
  if (d.layoutClass === "complex_layout") return "warning";
  if (d.layoutClass === "native_text") return "success";
  return "info";
}

function blockTypeLabel(type: SourceBlock["blockType"]): string {
  const labels: Record<string, string> = {
    heading: "標題",
    paragraph: "段落",
    table: "表格",
    list: "清單",
    footer: "頁尾",
    header: "頁首",
    image_ocr: "OCR",
    unknown: "未知",
  };
  return labels[type] ?? type;
}

function blockTypeTagType(
  type: SourceBlock["blockType"]
): "success" | "warning" | "danger" | "info" | "" {
  if (type === "heading") return "success";
  if (type === "table") return "warning";
  if (type === "image_ocr") return "info";
  return "";
}

function hasBbox(block: SourceBlock): boolean {
  return block.bbox.width > 0 && block.bbox.height > 0;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function onBlockClick(block: SourceBlock) {
  emit("blockClick", block);
}

function onBlockHover(block: SourceBlock) {
  emit("blockHover", block);
}

function onBlockLeave() {
  emit("blockLeave");
}

function scrollToBlock(blockId: string) {
  const el = blockRefs.get(blockId);
  if (el && scrollbarRef.value?.wrapRef) {
    const container = scrollbarRef.value.wrapRef;
    const offsetTop = el.offsetTop;
    container.scrollTo({ top: offsetTop - 80, behavior: "smooth" });
  }
}

defineExpose({ scrollToBlock });
</script>

<style scoped>
.parsed-blocks-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.blocks-scrollbar {
  flex: 1;
  height: 100%;
}

.page-group {
  margin-bottom: 8px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  position: sticky;
  top: 0;
  background: var(--el-bg-color);
  z-index: 10;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.page-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.detection-tag {
  font-size: 11px;
}

.block-item {
  padding: 10px 12px;
  margin: 4px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--el-bg-color-overlay);
}

.block-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.block-item.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-7);
}

.block-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.block-parser {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-left: auto;
}

.confidence-tag {
  font-size: 11px;
}

.block-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-regular);
  word-break: break-all;
}

.block-warnings {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-warning);
}

.warning-text {
  line-height: 1.4;
}

.no-bbox-warning {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
</style>
