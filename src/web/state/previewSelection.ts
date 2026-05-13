import { ref, readonly } from "vue";
import type { PdfPreviewDocument, SourceBlock, PreviewSelection } from "../../ingestion/types.js";

export type PdfParsePocStatus = "idle" | "uploading" | "parsing" | "ready" | "error";

const status = ref<PdfParsePocStatus>("idle");
const previewDocument = ref<PdfPreviewDocument | null>(null);
const activeBlockId = ref<string | null>(null);
const activeSelection = ref<PreviewSelection | null>(null);
const errorMessage = ref<string | null>(null);

export function usePreviewState() {
  function setStatus(s: PdfParsePocStatus) {
    status.value = s;
  }

  function setPreviewDocument(doc: PdfPreviewDocument) {
    previewDocument.value = doc;
    activeBlockId.value = null;
    activeSelection.value = null;
  }

  function setError(msg: string) {
    status.value = "error";
    errorMessage.value = msg;
  }

  function clearError() {
    errorMessage.value = null;
  }

  function selectBlock(block: SourceBlock) {
    activeBlockId.value = block.id;
    activeSelection.value = {
      blockId: block.id,
      page: block.page,
      bbox: block.bbox,
    };
  }

  function clearSelection() {
    activeBlockId.value = null;
    activeSelection.value = null;
  }

  return {
    status: readonly(status),
    previewDocument: readonly(previewDocument),
    activeBlockId: readonly(activeBlockId),
    activeSelection: readonly(activeSelection),
    errorMessage: readonly(errorMessage),
    setStatus,
    setPreviewDocument,
    setError,
    clearError,
    selectBlock,
    clearSelection,
  };
}
