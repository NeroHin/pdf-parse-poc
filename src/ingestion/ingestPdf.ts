import type { IngestionInput, PdfParseHint, SourceBlock } from "./types.js";
import { pdfjsPreflight } from "./preflight/pdfjsPreflight.js";
import { classifyPage } from "./detection/classifyPage.js";
import { buildRoutingPlan, buildRoutingWarnings } from "./detection/routingPlan.js";
import { runPdfjsAdapter } from "./parsers/pdfjsAdapter.js";
import {
  runOpendataloaderAdapter,
  opendataloaderWarning,
} from "./parsers/opendataloaderAdapter.js";
import { dedupeBlocks } from "./normalize/dedupe.js";
import { evaluateExtractionQuality } from "./quality/extractionQuality.js";
import { buildReviewPayload } from "./review/buildReviewPayload.js";
import type { ReviewPayload } from "./review/buildReviewPayload.js";

function normalizeUserHint(input: IngestionInput): PdfParseHint {
  const opts = input.advancedOptions ?? {};
  return {
    mode: input.parseMode,
    forceNativeText: opts.forceNativeText ?? false,
    forceOcr: opts.forceOcr ?? false,
    enableComplexTableParsing: opts.enableComplexTableParsing ?? false,
    enableSafetyFiltering: opts.enableSafetyFiltering ?? false,
  };
}

async function executeRoutingPlan(
  filePath: string,
  documentId: string,
  rawPages: import("./types.js").PdfjsPage[],
  plan: import("./types.js").ParserRoutingPlan
): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
  const allBlocks: SourceBlock[] = [];
  const warnings: string[] = [];

  for (const entry of plan) {
    if (entry.parser === "pdfjs") {
      const blocks = runPdfjsAdapter(rawPages, entry.pages, documentId);
      allBlocks.push(...blocks);
    } else {
      const modeMap = {
        opendataloader_default: "default",
        opendataloader_hybrid: "hybrid",
        opendataloader_safety: "safety",
      } as const;
      const mode = modeMap[entry.parser];
      const blocks = runOpendataloaderAdapter(filePath, entry.pages, documentId, mode);
      allBlocks.push(...blocks);
      warnings.push(opendataloaderWarning(entry.pages, mode));
    }
  }

  return { blocks: allBlocks, warnings };
}

export async function ingestPdf(input: IngestionInput): Promise<ReviewPayload> {
  const hint = normalizeUserHint(input);

  const preflight = await pdfjsPreflight(input.filePath);
  const detections = preflight.pages.map((stats) => classifyPage(stats, hint));

  const routingPlan = buildRoutingPlan(detections, hint);
  const routingWarnings = buildRoutingWarnings(detections, routingPlan, hint);

  const { blocks: firstPassBlocks, warnings: parserWarnings } =
    await executeRoutingPlan(input.filePath, input.documentId, preflight.rawPages, routingPlan);

  const dedupedBlocks = dedupeBlocks(firstPassBlocks, { bboxOverlapThreshold: 0.85 });

  const qualityReport = evaluateExtractionQuality(dedupedBlocks, detections);

  const document = {
    id: input.documentId,
    fileName: input.fileName,
    filePath: input.filePath,
    pageCount: preflight.pageCount,
    originalPdfUrl: `/api/pdf/${input.documentId}/original`,
  };

  return buildReviewPayload(
    document,
    dedupedBlocks,
    detections,
    qualityReport,
    [...routingWarnings, ...parserWarnings]
  );
}
