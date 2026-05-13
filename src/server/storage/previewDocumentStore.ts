import type { PdfPreviewDocument } from "../../ingestion/types.js";

const store = new Map<string, PdfPreviewDocument>();

export function savePreviewDocument(doc: PdfPreviewDocument): void {
  store.set(doc.documentId, doc);
}

export function getPreviewDocument(documentId: string): PdfPreviewDocument | undefined {
  return store.get(documentId);
}

export function hasPreviewDocument(documentId: string): boolean {
  return store.has(documentId);
}

export function deletePreviewDocument(documentId: string): void {
  store.delete(documentId);
}

export function getDocumentCount(): number {
  return store.size;
}
