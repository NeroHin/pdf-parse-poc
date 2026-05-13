import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { IngestionInput, PageTextStats, PdfParseHint, SourceBlock } from "./types.js";
import { popplerPreflight, type PreflightResult } from "./preflight/popplerPreflight.js";
import { buildOdlPageStats } from "./preflight/odlPageStats.js";
import { classifyPage } from "./detection/classifyPage.js";
import { runOpendataloaderAdapter } from "./parsers/opendataloaderAdapter.js";
import { dedupeBlocks } from "./normalize/dedupe.js";
import { evaluateExtractionQuality } from "./quality/extractionQuality.js";
import { buildReviewPayload } from "./review/buildReviewPayload.js";
import type { ReviewPayload } from "./review/buildReviewPayload.js";
import { computeOcrRepairPages } from "./ocr/ocrTriggers.js";
import { resolveOcrModelsFromEnv, type OcrModelProfile } from "./ocr/modelPaths.js";
import { runEsearchOcrRepairForPages } from "./ocr/esearchOcrRepair.js";
import { mergeOdlBlocksWithOcrRepair } from "./ocr/mergeOdlAndOcr.js";

const TMP_DIR = new URL("../../../tmp", import.meta.url).pathname;

type OcrRuntimeProfile = {
  profile: OcrModelProfile;
  dpiPrimary: number;
  dpiFallback: number;
  maxPages?: number;
};

function resolveOcrRuntimeProfile(input: IngestionInput): OcrRuntimeProfile {
  const adv = input.advancedOptions ?? {};
  const rawProfile = adv.ocrRepairProfile ?? process.env.OCR_MODEL_PROFILE ?? "quality";
  const profile: OcrModelProfile = rawProfile === "dev" ? "dev" : "quality";
  const dpiPrimary = Number(
    process.env.OCR_RASTER_DPI_PRIMARY ?? (profile === "dev" ? 100 : 150)
  );
  const dpiFallback = Number(
    process.env.OCR_RASTER_DPI_FALLBACK ?? (profile === "dev" ? 150 : 220)
  );
  const envMaxPages = process.env.OCR_REPAIR_MAX_PAGES
    ? Number(process.env.OCR_REPAIR_MAX_PAGES)
    : undefined;
  const hasAdvancedMaxPages = typeof adv.maxOcrPages === "number";
  const advancedMaxPages = hasAdvancedMaxPages ? Math.max(0, adv.maxOcrPages ?? 0) : undefined;
  const maxPages = hasAdvancedMaxPages
    ? advancedMaxPages === 0
      ? undefined
      : advancedMaxPages
    : envMaxPages !== undefined
      ? envMaxPages <= 0
        ? undefined
        : envMaxPages
      : profile === "dev"
        ? 2
        : undefined;

  return { profile, dpiPrimary, dpiFallback, maxPages };
}

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
  preflight: PreflightResult,
  pageStats: PageTextStats[],
  odlBlocks: SourceBlock[],
  mergedOdlItems: import("./types.js").OdlJsonItem[],
  warnings: string[]
): Promise<SourceBlock[]> {
  const adv = input.advancedOptions ?? {};
  if (adv.enableOcrRepair !== true) {
    return odlBlocks;
  }

  const pageStatsByNum = new Map(pageStats.map((s) => [s.pageNum, s]));
  const repairPages = computeOcrRepairPages(pageStatsByNum, mergedOdlItems, {
    enabled: true,
    repairOnScanOrLowText: adv.repairOnScanOrLowText === true,
    repairOnStructuralHole: adv.repairOnStructuralHole === true,
    repairOnTableLayout: adv.enableComplexTableParsing === true || adv.enableOcrRepair === true,
  });

  if (repairPages.size === 0) {
    return odlBlocks;
  }

  const runtime = resolveOcrRuntimeProfile(input);
  const models = resolveOcrModelsFromEnv(runtime.profile);
  if (!models) {
    warnings.push(
      `已啟用 OCR repair，但找不到 ${runtime.profile} profile 的模型或缺少檔案（det/rec/dict）。略過 eSearch-OCR。`
    );
    return odlBlocks;
  }

  const ocrDir = join(TMP_DIR, `ocr-${input.documentId}`);
  mkdirSync(ocrDir, { recursive: true });

  if (runtime.maxPages && repairPages.size > runtime.maxPages) {
    warnings.push(
      `OCR repair 使用 ${runtime.profile} profile，僅處理前 ${runtime.maxPages} / ${repairPages.size} 個觸發頁面。`
    );
  }

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
      dpiPrimary: runtime.dpiPrimary,
      dpiFallback: runtime.dpiFallback,
      maxPages: runtime.maxPages,
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
  const preflight = await popplerPreflight(input.filePath);

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
    const { blocks, mergedOdlItems, warnings } = await runOpendataloaderAdapter(
      input.filePath,
      preflight.pageInfos,
      input.documentId,
      odlOutputDir
    );
    parserWarnings = warnings;
    const pageStats = buildOdlPageStats(preflight.pageInfos, mergedOdlItems);
    let merged = blocks;
    merged = await applyOcrRepairLayer(
      input,
      preflight,
      pageStats,
      merged,
      mergedOdlItems,
      parserWarnings
    );
    dedupedBlocks = dedupeBlocks(merged, { bboxOverlapThreshold: 0.85 });

    const detections = pageStats.map((stats) => classifyPage(stats, hint));
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
