import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { IngestionInput, PdfParseHint, SourceBlock } from "./types.js";
import { pdfjsPreflight } from "./preflight/pdfjsPreflight.js";
import { classifyPage } from "./detection/classifyPage.js";
import { runPdfjsAdapter } from "./parsers/pdfjsAdapter.js";
import { runOpendataloaderAdapter } from "./parsers/opendataloaderAdapter.js";
import { dedupeBlocks } from "./normalize/dedupe.js";
import { evaluateExtractionQuality } from "./quality/extractionQuality.js";
import { buildReviewPayload } from "./review/buildReviewPayload.js";
import type { ReviewPayload } from "./review/buildReviewPayload.js";
import { computeOcrRepairPages } from "./ocr/ocrTriggers.js";
import { resolveOcrModelsFromEnv } from "./ocr/modelPaths.js";
import { runEsearchOcrRepairForPages } from "./ocr/esearchOcrRepair.js";
import { mergeOdlBlocksWithOcrRepair } from "./ocr/mergeOdlAndOcr.js";

const TMP_DIR = new URL("../../../tmp", import.meta.url).pathname;

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

async function applyOcrRepairLayer(
  input: IngestionInput,
  preflight: import("./preflight/pdfjsPreflight.js").PreflightResult,
  odlBlocks: SourceBlock[],
  mergedOdlItems: import("./types.js").OdlJsonItem[],
  warnings: string[]
): Promise<SourceBlock[]> {
  const adv = input.advancedOptions ?? {};
  if (adv.enableOcrRepair !== true) {
    return odlBlocks;
  }

  const pageStatsByNum = new Map(preflight.pages.map((s) => [s.pageNum, s]));
  const repairPages = computeOcrRepairPages(pageStatsByNum, mergedOdlItems, {
    enabled: true,
    repairOnScanOrLowText: adv.repairOnScanOrLowText === true,
    repairOnStructuralHole: adv.repairOnStructuralHole === true,
  });

  if (repairPages.size === 0) {
    return odlBlocks;
  }

  const models = resolveOcrModelsFromEnv();
  if (!models) {
    warnings.push(
      "已啟用 OCR repair，但未設定 ESEARCH_OCR_MODEL_DIR 或缺少檔案（det/rec/dict）。略過 eSearch-OCR。"
    );
    return odlBlocks;
  }

  const ocrDir = join(TMP_DIR, `ocr-${input.documentId}`);
  mkdirSync(ocrDir, { recursive: true });

  const concurrency =
    input.ocrRepairConcurrency ??
    Number(process.env.OCR_REPAIR_MAX_PAGES_IN_FLIGHT ?? 2);

  try {
    const { blocks: repairBlocks, warnings: rw } = await runEsearchOcrRepairForPages({
      pdfPath: input.filePath,
      documentId: input.documentId,
      pageTriggers: repairPages,
      pageInfos: preflight.pageInfos,
      models,
      workDir: ocrDir,
      concurrency,
    });
    warnings.push(...rw);
    return mergeOdlBlocksWithOcrRepair(odlBlocks, repairBlocks);
  } finally {
    if (existsSync(ocrDir)) {
      try {
        rmSync(ocrDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export async function ingestPdf(input: IngestionInput): Promise<ReviewPayload> {
  const hint = normalizeUserHint(input);
  const parserBackend = input.parserBackend ?? "auto";

  const preflight = await pdfjsPreflight(input.filePath);

  const odlOutputDir = join(TMP_DIR, `odl-${input.documentId}`);
  mkdirSync(odlOutputDir, { recursive: true });

  let dedupedBlocks: SourceBlock[];
  let parserWarnings: string[] = [];

  const document = {
    id: input.documentId,
    fileName: input.fileName,
    filePath: input.filePath,
    pageCount: preflight.pageCount,
    originalPdfUrl: `/api/pdf/${input.documentId}/original`,
  };

  try {
    if (parserBackend === "opendataloader") {
      const { blocks, mergedOdlItems, warnings } = await runOpendataloaderAdapter(
        input.filePath,
        preflight.pageInfos,
        input.documentId,
        odlOutputDir
      );
      parserWarnings = warnings;
      let merged = blocks;
      merged = await applyOcrRepairLayer(
        input,
        preflight,
        merged,
        mergedOdlItems,
        parserWarnings
      );
      dedupedBlocks = dedupeBlocks(merged, { bboxOverlapThreshold: 0.85 });
    } else if (parserBackend === "pdfjs-extract") {
      const allPages = preflight.rawPages.map((p) => p.pageInfo.num);
      const blocks = runPdfjsAdapter(preflight.rawPages, allPages, input.documentId);
      dedupedBlocks = dedupeBlocks(blocks, { bboxOverlapThreshold: 0.85 });
    } else {
      const { blocks, mergedOdlItems, warnings } = await runOpendataloaderAdapter(
        input.filePath,
        preflight.pageInfos,
        input.documentId,
        odlOutputDir
      );
      parserWarnings = warnings;
      let merged = blocks;
      merged = await applyOcrRepairLayer(
        input,
        preflight,
        merged,
        mergedOdlItems,
        parserWarnings
      );
      dedupedBlocks = dedupeBlocks(merged, { bboxOverlapThreshold: 0.85 });
    }

    const detections = preflight.pages.map((stats) => classifyPage(stats, hint));
    const qualityReport = evaluateExtractionQuality(dedupedBlocks, detections);

    return buildReviewPayload(
      document,
      dedupedBlocks,
      detections,
      qualityReport,
      parserWarnings
    );
  } finally {
    if (existsSync(odlOutputDir)) {
      try {
        rmSync(odlOutputDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
