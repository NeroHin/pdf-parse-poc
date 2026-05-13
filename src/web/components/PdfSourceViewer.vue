<template>
  <div class="pdf-source-viewer">
    <div v-if="!pdfUrl" class="empty-state">
      <el-empty description="上傳 PDF 後顯示原始文件" :image-size="80" />
    </div>

    <template v-else>
      <div v-if="loading" class="loading-overlay">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <span>載入 PDF 中...</span>
      </div>

      <el-scrollbar ref="scrollbarRef" class="pages-scrollbar">
        <div class="pages-container">
          <div
            v-for="pageNum in totalPages"
            :key="pageNum"
            :ref="(el) => setPageContainerRef(pageNum, el as HTMLElement | null)"
            class="page-wrapper"
          >
            <div class="page-number-label">第 {{ pageNum }} 頁</div>
            <div class="canvas-container" :style="getContainerStyle(pageNum)">
              <canvas
                :ref="(el) => setCanvasRef(pageNum, el as HTMLCanvasElement | null)"
                class="pdf-canvas"
              />
              <!-- Highlight overlay -->
              <div class="highlight-layer" @click.self="onCanvasAreaClick">
                <div
                  v-for="hl in getHighlights(pageNum)"
                  :key="hl.blockId"
                  :class="['highlight-box', { active: hl.blockId === activeBlockId, hover: hl.blockId === hoverBlockId }]"
                  :style="getHighlightStyle(hl, pageNum)"
                  @click.stop="onHighlightClick(hl.blockId)"
                />
              </div>
            </div>
          </div>
        </div>
      </el-scrollbar>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick, onUnmounted } from "vue";
import { Loading } from "@element-plus/icons-vue";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { SourceBlock, BboxCoords } from "../../ingestion/types.js";

// Set pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

type HighlightEntry = {
  blockId: string;
  page: number;
  bbox: BboxCoords;
};

const props = defineProps<{
  pdfUrl: string | null;
  blocks: SourceBlock[];
  activeBlockId: string | null;
  hoverBlockId: string | null;
}>();

const emit = defineEmits<{
  highlightClick: [blockId: string];
}>();

const loading = ref(false);
const totalPages = ref(0);
const scrollbarRef = ref<{ wrapRef: HTMLElement } | null>(null);

let pdfDoc: PDFDocumentProxy | null = null;

const canvasRefs = new Map<number, HTMLCanvasElement>();
const pageContainerRefs = new Map<number, HTMLElement>();
const pageViewports = new Map<number, { width: number; height: number }>();
const renderTasks = new Map<number, ReturnType<PDFPageProxy["render"]>>();

function setCanvasRef(pageNum: number, el: HTMLCanvasElement | null) {
  if (el) canvasRefs.set(pageNum, el);
  else canvasRefs.delete(pageNum);
}

function setPageContainerRef(pageNum: number, el: HTMLElement | null) {
  if (el) pageContainerRefs.set(pageNum, el);
  else pageContainerRefs.delete(pageNum);
}

function getContainerStyle(pageNum: number) {
  const vp = pageViewports.get(pageNum);
  if (!vp) return {};
  return { width: `${vp.width}px`, height: `${vp.height}px` };
}

const SCALE = 1.5;

async function loadAndRenderPdf(url: string) {
  loading.value = true;
  totalPages.value = 0;
  canvasRefs.clear();
  pageContainerRefs.clear();
  pageViewports.clear();

  try {
    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }

    pdfDoc = await pdfjsLib.getDocument(url).promise;
    totalPages.value = pdfDoc.numPages;

    await nextTick();

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      await renderPage(pdfDoc, pageNum);
    }
  } catch (err) {
    console.error("PDF load error:", err);
  } finally {
    loading.value = false;
  }
}

async function renderPage(doc: PDFDocumentProxy, pageNum: number) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: SCALE });

  pageViewports.set(pageNum, { width: viewport.width, height: viewport.height });
  await nextTick();

  const canvas = canvasRefs.get(pageNum);
  if (!canvas) return;

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext("2d");
  if (!context) return;

  const existingTask = renderTasks.get(pageNum);
  try {
    existingTask?.cancel();
  } catch {
    // ignore cancel errors
  }

  const task = page.render({ canvasContext: context, viewport });
  renderTasks.set(pageNum, task);

  try {
    await task.promise;
  } catch (err: unknown) {
    if ((err as { name?: string })?.name !== "RenderingCancelledException") {
      console.error(`Render page ${pageNum} error:`, err);
    }
  }
}

// Highlights derived from blocks
const allHighlights = computed<HighlightEntry[]>(() =>
  props.blocks
    .filter((b) => b.bbox.width > 0 && b.bbox.height > 0)
    .map((b) => ({ blockId: b.id, page: b.page, bbox: b.bbox }))
);

function getHighlights(pageNum: number): HighlightEntry[] {
  return allHighlights.value.filter(
    (h) => h.page === pageNum && (h.blockId === props.activeBlockId || h.blockId === props.hoverBlockId)
  );
}

function getHighlightStyle(hl: HighlightEntry, pageNum: number) {
  const vp = pageViewports.get(pageNum);
  if (!vp) return {};

  const { x, y, width, height } = hl.bbox;
  return {
    left: `${x * vp.width}px`,
    top: `${y * vp.height}px`,
    width: `${width * vp.width}px`,
    height: `${height * vp.height}px`,
  };
}

function onHighlightClick(blockId: string) {
  emit("highlightClick", blockId);
}

function onCanvasAreaClick() {
  // click on canvas outside highlight does nothing
}

// PAGE_LABEL_HEIGHT: approximate height of .page-number-label + gap
const PAGE_LABEL_HEIGHT = 24;
const SCROLL_MARGIN = 80;

function scrollToBlock(blockId: string) {
  const block = props.blocks.find((b) => b.id === blockId);
  if (!block) return;

  const container = pageContainerRefs.get(block.page);
  const vp = pageViewports.get(block.page);
  if (!container || !vp || !scrollbarRef.value?.wrapRef) {
    scrollToPage(block.page);
    return;
  }

  const wrap = scrollbarRef.value.wrapRef;
  // container.offsetTop = top of page-wrapper div
  // + PAGE_LABEL_HEIGHT = skip the page number label
  // + bbox.y * vp.height = exact Y position of block within the rendered page
  const bboxOffsetInPage = block.bbox.y * vp.height;
  const targetScroll =
    container.offsetTop + PAGE_LABEL_HEIGHT + bboxOffsetInPage - SCROLL_MARGIN;

  wrap.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
}

function scrollToPage(pageNum: number) {
  const container = pageContainerRefs.get(pageNum);
  if (container && scrollbarRef.value?.wrapRef) {
    const wrap = scrollbarRef.value.wrapRef;
    wrap.scrollTo({ top: container.offsetTop - 16, behavior: "smooth" });
  }
}

watch(
  () => props.pdfUrl,
  (url) => {
    if (url) loadAndRenderPdf(url);
  },
  { immediate: true }
);

watch(
  () => props.activeBlockId,
  (blockId) => {
    if (!blockId) return;
    scrollToBlock(blockId);
  }
);

onUnmounted(() => {
  if (pdfDoc) {
    pdfDoc.destroy();
    pdfDoc = null;
  }
});

defineExpose({ scrollToPage, scrollToBlock });
</script>

<style scoped>
.pdf-source-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #525659;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--el-bg-color-page);
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  z-index: 100;
}

.pages-scrollbar {
  flex: 1;
  height: 100%;
}

.pages-container {
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.page-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.page-number-label {
  font-size: 12px;
  color: #ccc;
  align-self: flex-start;
}

.canvas-container {
  position: relative;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  min-width: 100px;
  min-height: 100px;
}

.pdf-canvas {
  display: block;
}

.highlight-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.highlight-box {
  position: absolute;
  border: 2px solid transparent;
  background: transparent;
  border-radius: 2px;
  transition: all 0.1s ease;
  pointer-events: all;
  cursor: pointer;
}

.highlight-box.hover {
  border-color: rgba(64, 158, 255, 0.6);
  background: rgba(64, 158, 255, 0.1);
}

.highlight-box.active {
  border-color: rgba(230, 162, 60, 0.9);
  background: rgba(230, 162, 60, 0.2);
  box-shadow: 0 0 0 1px rgba(230, 162, 60, 0.5);
}
</style>
