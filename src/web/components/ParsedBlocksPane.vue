<template>
  <div class="parsed-blocks-pane">
    <div v-if="blocks.length === 0" class="empty-state">
      <el-empty description="尚無解析結果" :image-size="80" />
    </div>

    <el-scrollbar v-else ref="scrollbarRef" class="blocks-scrollbar">
      <div
        v-for="pageNum in pageNumbers"
        :key="pageNum"
        :ref="(el) => setPageGroupRef(pageNum, el as HTMLElement | null)"
        :data-page="pageNum"
        class="page-group"
      >
        <!-- Page header -->
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
          <span class="page-block-count">{{ getPageBlocks(pageNum).length }} blocks</span>
          <el-button
            size="small"
            text
            class="copy-page-button"
            @click.stop="onCopyPage(pageNum)"
          >
            Copy
          </el-button>
        </div>

        <!-- Merged page text: clickable, readable -->
        <div
          class="page-merged-text"
          :class="{ 'has-active': hasActiveBlockOnPage(pageNum) }"
          @click="onPageTextClick(pageNum)"
        >
          <span
            v-for="block in getPageBlocks(pageNum)"
            :key="block.id"
            :class="['inline-block-span', getBlockTypeClass(block), { active: activeBlockId === block.id }]"
            :title="blockTypeLabel(block.blockType)"
            @click.stop="onBlockClick(block)"
            @mouseenter="onBlockHover(block)"
            @mouseleave="onBlockLeave"
          >{{ block.text }}</span>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
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
  pageClick: [pageNum: number];
  copyPage: [pageNum: number];
}>();

const scrollbarRef = ref<{ wrapRef: HTMLElement } | null>(null);
const pageGroupRefs = new Map<number, HTMLElement>();

function setPageGroupRef(pageNum: number, el: HTMLElement | null) {
  if (el) pageGroupRefs.set(pageNum, el);
  else pageGroupRefs.delete(pageNum);
}

const pageNumbers = computed(() => {
  const pages = new Set(props.blocks.map((b) => b.page));
  return [...pages].sort((a, b) => a - b);
});

function getPageBlocks(page: number) {
  return props.blocks.filter((b) => b.page === page);
}

function hasActiveBlockOnPage(page: number): boolean {
  return getPageBlocks(page).some((b) => b.id === props.activeBlockId);
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

function getBlockTypeClass(block: SourceBlock): string {
  const classMap: Partial<Record<SourceBlock["blockType"], string>> = {
    heading: "type-heading",
    table: "type-table",
    list: "type-list",
    footer: "type-footer",
    header: "type-header",
    image_ocr: "type-image",
  };
  return classMap[block.blockType] ?? "";
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

function onPageTextClick(pageNum: number) {
  emit("pageClick", pageNum);
}

function onCopyPage(pageNum: number) {
  emit("copyPage", pageNum);
}

function scrollToBlock(blockId: string) {
  const block = props.blocks.find((b) => b.id === blockId);
  if (!block) return;

  const el = pageGroupRefs.get(block.page);
  if (el && scrollbarRef.value?.wrapRef) {
    const container = scrollbarRef.value.wrapRef;
    container.scrollTo({ top: el.offsetTop - 60, behavior: "smooth" });
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
  margin-bottom: 2px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 5px;
  position: sticky;
  top: 0;
  background: var(--el-bg-color-page);
  z-index: 10;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.page-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.detection-tag {
  font-size: 11px;
}

.page-block-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.copy-page-button {
  padding: 0 4px;
  min-height: 22px;
  font-size: 11px;
}

/* Merged readable text area */
.page-merged-text {
  padding: 8px 12px 10px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  cursor: default;
  word-break: break-all;
}

.page-merged-text.has-active {
  background: var(--el-color-warning-light-9);
}

/* Inline block spans - each block is an inline span in the merged text */
.inline-block-span {
  cursor: pointer;
  border-radius: 2px;
  transition: background 0.1s;
  padding: 0 1px;
}

.inline-block-span:hover {
  background: var(--el-color-primary-light-8);
}

.inline-block-span.active {
  background: var(--el-color-warning-light-7);
  outline: 1px solid var(--el-color-warning-light-5);
  border-radius: 2px;
}

/* Block type color hints */
.inline-block-span.type-heading {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.inline-block-span.type-table {
  font-family: monospace;
  font-size: 12px;
  background: var(--el-fill-color-lighter);
}

.inline-block-span.type-footer,
.inline-block-span.type-header {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.inline-block-span.type-image {
  color: var(--el-color-info);
  font-style: italic;
}
</style>
