export type PdfParseModeHint =
  | "auto"
  | "native_text"
  | "scanned_image"
  | "mixed_or_unknown";

export type PdfAdvancedOptions = {
  forceNativeText?: boolean;
  forceOcr?: boolean;
  enableComplexTableParsing?: boolean;
  enableSafetyFiltering?: boolean;
};

export type PdfParseHint = {
  mode: PdfParseModeHint;
  forceNativeText: boolean;
  forceOcr: boolean;
  enableComplexTableParsing: boolean;
  enableSafetyFiltering: boolean;
};

export type PageDetection = {
  page: number;
  textItemCount: number;
  charCount: number;
  cjkCharRatio: number;
  whitespaceRatio: number;
  avgFontSize: number | null;
  bboxCoverageRatio: number;
  hasExtractableText: boolean;
  suspectedScanned: boolean;
  suspectedGarbledText: boolean;
  suspectedTableHeavy: boolean;
  suspectedHiddenOrOffPageText: boolean;
  layoutClass:
    | "native_text"
    | "scanned_image"
    | "mixed"
    | "suspicious"
    | "complex_layout";
  parserRecommendation:
    | "pdfjs"
    | "opendataloader_default"
    | "opendataloader_hybrid"
    | "opendataloader_safety";
  reasons: string[];
};

export type BboxCoords = {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: "pdf-points" | "normalized";
};

export type SourceBlock = {
  id: string;
  documentId: string;
  page: number;
  blockType:
    | "heading"
    | "paragraph"
    | "table"
    | "list"
    | "footer"
    | "header"
    | "image_ocr"
    | "unknown";
  text: string;
  bbox: BboxCoords;
  parser:
    | "pdfjs-extract"
    | "opendataloader-default"
    | "opendataloader-hybrid"
    | "opendataloader-safety";
  parserVersion: string;
  extractionMode: "native_text" | "ocr" | "hybrid" | "safety";
  confidence: number;
  warnings: string[];
  sourceHash: string;
};

export type PdfPreviewDocument = {
  documentId: string;
  fileName: string;
  pageCount: number;
  originalPdfUrl: string;
  detections: PageDetection[];
  blocks: SourceBlock[];
  warnings: string[];
};

export type PreviewSelection = {
  blockId: string;
  page: number;
  bbox: BboxCoords;
};

export type PdfjsTextItem = {
  x: number;
  y: number;
  str: string;
  dir: string;
  width: number;
  height: number;
  fontName: string;
};

export type PdfjsPageInfo = {
  num: number;
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

export type PdfjsPage = {
  pageInfo: PdfjsPageInfo;
  links: string[];
  content: PdfjsTextItem[];
};

export type PdfjsExtractResult = {
  filename: string;
  meta: Record<string, unknown>;
  pdfInfo: {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
    version: string;
  };
  pages: PdfjsPage[];
};

export type PageTextStats = {
  pageNum: number;
  pageWidth: number;
  pageHeight: number;
  textItemCount: number;
  charCount: number;
  cjkCharCount: number;
  cjkCharRatio: number;
  whitespaceCount: number;
  whitespaceRatio: number;
  avgFontSize: number | null;
  bboxCoverageRatio: number;
  hasExtractableText: boolean;
  offPageItemCount: number;
  tinyTextItemCount: number;
  xCoords: number[];
  yCoords: number[];
  fontSizes: number[];
};

export type ParserRoutingEntry = {
  pages: number[];
  parser:
    | "pdfjs"
    | "opendataloader_default"
    | "opendataloader_hybrid"
    | "opendataloader_safety";
  reason: "system_detection" | "hint_plus_detection" | "hint_allowed_by_detection";
};

export type ParserRoutingPlan = ParserRoutingEntry[];

export type QualityReport = {
  requiresFallback: boolean;
  lowConfidencePages: number[];
  emptyPages: number[];
  warnings: string[];
};

export type UploadedDocument = {
  id: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  originalPdfUrl: string;
};

export type IngestionInput = {
  filePath: string;
  fileName: string;
  documentId: string;
  parseMode: PdfParseModeHint;
  advancedOptions?: PdfAdvancedOptions;
};
