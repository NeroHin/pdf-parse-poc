import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { unlinkSync } from "node:fs";
import { basename as pathBasename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { ImageData } from "@napi-rs/canvas";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { init } from "esearch-ocr";
import * as ort from "onnxruntime-node";
import pLimit from "p-limit";
import type {
  OcrRepairAttempt,
  PreflightPageInfo,
  SourceBlock,
  SourceBlockProvenance,
} from "../types.js";
import type { OcrRepairTrigger } from "./ocrTriggers.js";
import { quadToNormalizedBbox, type Quad } from "./bboxRaster.js";
import { ensureEsearchNodeCanvasEnv } from "./nodeCanvasEnv.js";
import { rasterizePdfPagePoppler } from "./popplerRasterize.js";
import type { ResolvedOcrModels } from "./modelPaths.js";
import { reconstructOcrParagraphs, type ReconstructedOcrParagraph } from "./layoutReconstruction.js";
import { normalizeOcrText } from "./textCleanup.js";

const ESEARCH_LIB_VERSION = "esearch-ocr-8.5.0";
const MEAN_CONF_THRESHOLD = 0.55;
const OCR_WORKER = fileURLToPath(new URL("./ocrRepairWorker.ts", import.meta.url));

type OcrEngine = Awaited<ReturnType<typeof init>>;

let primaryEngine: OcrEngine | null = null;
let fallbackEngine: OcrEngine | null = null;

async function ensurePrimaryEngine(models: ResolvedOcrModels): Promise<OcrEngine> {
  if (primaryEngine) return primaryEngine;
  ensureEsearchNodeCanvasEnv();
  primaryEngine = await init({
    ort,
    det: { input: models.det },
    rec: {
      input: models.rec,
      decodeDic: models.dictText,
      optimize: { space: false },
    },
    docCls: models.docCls ? { input: models.docCls } : undefined,
    analyzeLayout: {},
    dev: false,
    log: false,
  });
  return primaryEngine;
}

async function ensureFallbackEngine(models: ResolvedOcrModels): Promise<OcrEngine | null> {
  if (!models.recFallback || !models.dictFallbackText) return null;
  if (fallbackEngine) return fallbackEngine;
  ensureEsearchNodeCanvasEnv();
  fallbackEngine = await init({
    ort,
    det: { input: models.det },
    rec: {
      input: models.recFallback,
      decodeDic: models.dictFallbackText,
      optimize: { space: true },
    },
    docCls: models.docCls ? { input: models.docCls } : undefined,
    analyzeLayout: {},
    dev: false,
    log: false,
  });
  return fallbackEngine;
}

async function pngToImageData(pngPath: string): Promise<ImageData> {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new ImageData(new Uint8ClampedArray(data), info.width, info.height);
}

async function preprocessRaster(img: ImageData): Promise<ImageData> {
  const { data, info } = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .greyscale()
    .normalize()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new ImageData(new Uint8ClampedArray(data), info.width, info.height);
}

function avgConfidence(paragraphs: { mean: number }[]): number {
  const values = paragraphs
    .map((p) => Number(p.mean))
    .filter((v) => Number.isFinite(v));
  if (values.length === 0) return 0;
  return values.reduce((s, p) => s + p, 0) / values.length;
}

function safeUnlink(p: string) {
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

type Para = {
  text: string;
  mean: number;
  box: Quad;
  originalText?: string;
  cleanup?: {
    originalText: string;
    normalizedText: string;
    openccConfig?: "s2tw.json";
    fixes: {
      type: "opencc" | "ocr_confusion" | "whitespace" | "punctuation";
      before: string;
      after: string;
    }[];
  };
  layout?: {
    strategy: "esearch_paragraphs" | "esearch_columns" | "two_column_legal_table" | "two_column_table";
    columnRole?: "title" | "article" | "explanation" | "left" | "right" | "unknown";
    columnIndex?: number;
    columnCount?: number;
  };
};

type EsearchOcrOutput = {
  src?: ReconstructedOcrParagraph[];
  columns?: {
    outerBox: Quad;
    parragraphs?: { parse?: Para }[];
  }[];
  parragraphs?: Para[];
};

async function reconstructAndCleanupParagraphs(
  out: EsearchOcrOutput,
  raster: NonNullable<SourceBlockProvenance["raster"]>
): Promise<Para[]> {
  const reconstructed = reconstructOcrParagraphs(out, raster);
  const cleaned: Para[] = [];
  for (const item of reconstructed) {
    const cleanup = await normalizeOcrText(item.text);
    cleaned.push({
      text: cleanup.text,
      originalText: cleanup.originalText,
      mean: item.mean,
      box: item.box,
      cleanup: {
        originalText: cleanup.originalText,
        normalizedText: cleanup.text,
        openccConfig: cleanup.openccConfig,
        fixes: cleanup.fixes,
      },
      layout: {
        strategy: item.layoutStrategy,
        columnRole: item.columnRole,
        columnIndex: item.columnIndex,
        columnCount: item.columnCount,
      },
    });
  }
  return cleaned;
}

async function runBestEffortOcr(
  models: ResolvedOcrModels,
  pdfPath: string,
  pageNum: number,
  pageInfo: PreflightPageInfo,
  workDir: string,
  primaryDpi: number,
  fallbackDpi: number
): Promise<{
  paragraphs: Para[];
  attempts: OcrRepairAttempt[];
  raster: NonNullable<SourceBlockProvenance["raster"]>;
  modelLabel: string;
}> {
  const attempts: OcrRepairAttempt[] = [];
  const engine = await ensurePrimaryEngine(models);
  const primaryModelLabel = `${ESEARCH_LIB_VERSION};det=${pathBasename(models.det)};rec=${pathBasename(models.rec)}`;

  let usedDpi = primaryDpi;
  const prefix1 = `doc${pageNum}a`;
  const r1 = await rasterizePdfPagePoppler(pdfPath, pageNum, primaryDpi, workDir, prefix1);
  attempts.push({ stage: "poppler_raster", dpi: primaryDpi });
  let img = await pngToImageData(r1.pngPath);
  safeUnlink(r1.pngPath);

  let out = (await engine.ocr(img)) as EsearchOcrOutput;
  const primaryRaster: NonNullable<SourceBlockProvenance["raster"]> = {
    engine: "poppler",
    dpi: usedDpi,
    widthPx: img.width,
    heightPx: img.height,
    pagePtsWidth: pageInfo.width,
    pagePtsHeight: pageInfo.height,
  };
  let paragraphs: Para[] = await reconstructAndCleanupParagraphs(out, primaryRaster);
  let mean = avgConfidence(paragraphs);
  attempts.push({
    stage: "primary_ocr",
    dpi: primaryDpi,
    meanConfidence: mean,
    paragraphCount: paragraphs.length,
    modelLabel: primaryModelLabel,
  });

  if (mean < MEAN_CONF_THRESHOLD || paragraphs.length === 0) {
    attempts.push({ stage: "preprocess_greyscale_normalize" });
    const pre = await preprocessRaster(img);
    out = (await engine.ocr(pre)) as EsearchOcrOutput;
    const preRaster: NonNullable<SourceBlockProvenance["raster"]> = {
      ...primaryRaster,
      widthPx: pre.width,
      heightPx: pre.height,
    };
    paragraphs = await reconstructAndCleanupParagraphs(out, preRaster);
    mean = avgConfidence(paragraphs);
    img = pre;
    attempts.push({
      stage: "primary_ocr",
      dpi: usedDpi,
      meanConfidence: mean,
      paragraphCount: paragraphs.length,
      modelLabel: primaryModelLabel,
    });
  }

  if (mean < MEAN_CONF_THRESHOLD || paragraphs.length === 0) {
    attempts.push({ stage: "reraster", dpi: fallbackDpi });
    const prefix2 = `doc${pageNum}b`;
    const r2 = await rasterizePdfPagePoppler(pdfPath, pageNum, fallbackDpi, workDir, prefix2);
    img = await pngToImageData(r2.pngPath);
    usedDpi = fallbackDpi;
    safeUnlink(r2.pngPath);
    out = (await engine.ocr(img)) as EsearchOcrOutput;
    const fallbackRaster: NonNullable<SourceBlockProvenance["raster"]> = {
      ...primaryRaster,
      dpi: fallbackDpi,
      widthPx: img.width,
      heightPx: img.height,
    };
    paragraphs = await reconstructAndCleanupParagraphs(out, fallbackRaster);
    mean = avgConfidence(paragraphs);
    attempts.push({
      stage: "primary_ocr",
      dpi: fallbackDpi,
      meanConfidence: mean,
      paragraphCount: paragraphs.length,
      modelLabel: primaryModelLabel,
    });
  }

  const fb = await ensureFallbackEngine(models);
  if (fb && (mean < MEAN_CONF_THRESHOLD || paragraphs.length === 0)) {
    const fallbackModelLabel = `${ESEARCH_LIB_VERSION};det=${pathBasename(models.det)};rec=${pathBasename(models.recFallback ?? models.rec)}`;
    attempts.push({ stage: "fallback_rec_ppocr_v4_doc", modelLabel: fallbackModelLabel });
    out = (await fb.ocr(img)) as EsearchOcrOutput;
    const fallbackRecRaster: NonNullable<SourceBlockProvenance["raster"]> = {
      ...primaryRaster,
      dpi: usedDpi,
      widthPx: img.width,
      heightPx: img.height,
    };
    paragraphs = await reconstructAndCleanupParagraphs(out, fallbackRecRaster);
    mean = avgConfidence(paragraphs);
    attempts.push({
      stage: "fallback_rec_ppocr_v4_doc",
      dpi: usedDpi,
      meanConfidence: mean,
      paragraphCount: paragraphs.length,
      modelLabel: fallbackModelLabel,
    });
  }

  const raster: NonNullable<SourceBlockProvenance["raster"]> = {
    engine: "poppler",
    dpi: usedDpi,
    widthPx: img.width,
    heightPx: img.height,
    pagePtsWidth: pageInfo.width,
    pagePtsHeight: pageInfo.height,
  };

  return { paragraphs, attempts, raster, modelLabel: primaryModelLabel };
}

function hashSnippet(text: string, page: number): string {
  return createHash("sha256")
    .update(`${page}:${text}`)
    .digest("hex")
    .slice(0, 16);
}

function layoutRoleRank(block: SourceBlock): number {
  const layout = block.provenance?.layout;
  const strategy = layout?.strategy;
  if (strategy !== "two_column_legal_table" && strategy !== "two_column_table") return 10;
  switch (layout?.columnRole) {
    case "title":
      return 0;
    case "article":
    case "left":
      return 1;
    case "explanation":
    case "right":
      return 2;
    default:
      return 3;
  }
}

function compareOcrBlocks(a: SourceBlock, b: SourceBlock): number {
  return (
    a.page - b.page ||
    layoutRoleRank(a) - layoutRoleRank(b) ||
    a.bbox.y - b.bbox.y ||
    a.bbox.x - b.bbox.x
  );
}

export async function runEsearchOcrRepairPage(options: {
  pdfPath: string;
  documentId: string;
  pageNum: number;
  triggers: OcrRepairTrigger[];
  pageInfo: PreflightPageInfo;
  models: ResolvedOcrModels;
  workDir: string;
  dpiPrimary?: number;
  dpiFallback?: number;
}): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
  const warnings: string[] = [];
  const blocks: SourceBlock[] = [];
  const dpiPrimary = options.dpiPrimary ?? Number(process.env.OCR_RASTER_DPI_PRIMARY ?? 150);
  const dpiFallback = options.dpiFallback ?? Number(process.env.OCR_RASTER_DPI_FALLBACK ?? 220);

  try {
    const outcome = await runBestEffortOcr(
      options.models,
      options.pdfPath,
      options.pageNum,
      options.pageInfo,
      options.workDir,
      dpiPrimary,
      dpiFallback
    );

    const fallbackReasons = outcome.attempts.map((a) =>
      a.dpi ? `${a.stage}_${a.dpi}` : a.stage
    );

    for (const p of outcome.paragraphs) {
      if (!p.text?.trim()) continue;
      const provBase: SourceBlockProvenance = {
        parserId: "esearch-ocr-repair",
        modelLabel: outcome.modelLabel,
        raster: outcome.raster,
        fallbackReasons,
        ocrAttempts: outcome.attempts,
        repairTriggers: options.triggers,
        textCleanup: p.cleanup,
        layout: p.layout,
      };
      const bbox = quadToNormalizedBbox(
        p.box,
        outcome.raster.widthPx,
        outcome.raster.heightPx,
        options.pageInfo.width,
        options.pageInfo.height
      );
      blocks.push({
        id: uuidv4(),
        documentId: options.documentId,
        page: options.pageNum,
        blockType: "paragraph",
        text: p.text.trim(),
        bbox,
        parser: "esearch-ocr-repair",
        parserVersion: ESEARCH_LIB_VERSION,
        extractionMode: "ocr",
        confidence: Math.min(0.99, Math.max(0.5, Number.isFinite(p.mean) ? p.mean : 0.5)),
        warnings: [],
        sourceHash: hashSnippet(p.text, options.pageNum),
        provenance: provBase,
      });
    }
  } catch (e) {
    warnings.push(
      `OCR repair 第 ${options.pageNum} 頁失敗: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return { blocks, warnings };
}

function runOcrRepairWorker(options: {
  pdfPath: string;
  documentId: string;
  pageNum: number;
  triggers: OcrRepairTrigger[];
  pageInfo: PreflightPageInfo;
  models: ResolvedOcrModels;
  workDir: string;
  dpiPrimary?: number;
  dpiFallback?: number;
}): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, ["--import", "tsx", OCR_WORKER], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const settleResolve = (value: { blocks: SourceBlock[]; warnings: string[] }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdin.on("error", settleReject);
    child.stdout.on("error", settleReject);
    child.stderr.on("error", settleReject);
    child.on("error", settleReject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        settleReject(new Error(`OCR worker exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { blocks: SourceBlock[]; warnings: string[] };
        if (stderr) parsed.warnings.push(`OCR worker stderr: ${stderr.slice(0, 500)}`);
        settleResolve(parsed);
      } catch (e) {
        settleReject(new Error(`OCR worker returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`));
      }
    });

    child.stdin.end(JSON.stringify(options), (error?: Error | null) => {
      if (error) settleReject(error);
    });
  });
}

type OcrWorkerJob = {
  id: number;
  payload: {
    pdfPath: string;
    documentId: string;
    pageNum: number;
    triggers: OcrRepairTrigger[];
    pageInfo: PreflightPageInfo;
    models: ResolvedOcrModels;
    workDir: string;
    dpiPrimary?: number;
    dpiFallback?: number;
  };
};

type OcrWorkerResponse = {
  id: number;
  ok: boolean;
  result?: { blocks: SourceBlock[]; warnings: string[] };
  error?: string;
};

class PersistentOcrWorker {
  private child = spawn(process.execPath, ["--import", "tsx", OCR_WORKER], {
    env: { ...process.env, OCR_WORKER_PERSISTENT: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: { blocks: SourceBlock[]; warnings: string[] }) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private stderr = "";
  private closed = false;
  private closing = false;

  constructor() {
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      let response: OcrWorkerResponse;
      try {
        response = JSON.parse(line) as OcrWorkerResponse;
      } catch {
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok && response.result) {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error(response.error ?? "OCR worker failed"));
      }
    });

    rl.on("error", (error) => this.rejectAll(error instanceof Error ? error : new Error(String(error))));

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 2000) this.stderr = this.stderr.slice(-2000);
    });

    this.child.stdin.on("error", (error) => this.rejectAll(error));
    this.child.stdout.on("error", (error) => this.rejectAll(error));
    this.child.stderr.on("error", (error) => this.rejectAll(error));
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("close", (code) => {
      this.closed = true;
      if (this.closing && this.pending.size === 0) return;
      this.rejectAll(new Error(`OCR persistent worker exited with code ${code}: ${this.stderr}`));
    });
  }

  run(payload: OcrWorkerJob["payload"]): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
    const id = this.nextId++;
    const job: OcrWorkerJob = { id, payload };
    return new Promise((resolve, reject) => {
      if (this.closed || this.closing || !this.child.stdin.writable) {
        reject(new Error("OCR persistent worker is not writable"));
        return;
      }
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(job)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  close(): void {
    if (this.closed || this.closing) return;
    this.closing = true;
    if (this.child.stdin.writable) {
      this.child.stdin.end();
    }
    const killTimer = setTimeout(() => {
      if (!this.closed) this.child.kill("SIGTERM");
    }, 500);
    killTimer.unref();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function runWithPersistentWorkerPool(
  jobs: OcrWorkerJob["payload"][],
  workerCount: number
): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
  const blocks: SourceBlock[] = [];
  const warnings: string[] = [];
  const workers = Array.from({ length: Math.max(1, workerCount) }, () => new PersistentOcrWorker());
  let cursor = 0;

  async function runLane(worker: PersistentOcrWorker) {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const result = await worker.run(job);
      blocks.push(...result.blocks);
      warnings.push(...result.warnings);
    }
  }

  try {
    await Promise.all(workers.map(runLane));
  } finally {
    for (const worker of workers) worker.close();
  }

  return { blocks, warnings };
}

export async function runEsearchOcrRepairForPages(options: {
  pdfPath: string;
  documentId: string;
  pageTriggers: Map<number, OcrRepairTrigger[]>;
  pageInfos: PreflightPageInfo[];
  models: ResolvedOcrModels;
  workDir: string;
  concurrency: number;
  dpiPrimary?: number;
  dpiFallback?: number;
  maxPages?: number;
}): Promise<{ blocks: SourceBlock[]; warnings: string[] }> {
  const { documentId, pageTriggers, pageInfos, models, workDir, concurrency } = options;
  const warnings: string[] = [];
  const blocks: SourceBlock[] = [];

  const pageMap = new Map(pageInfos.map((p) => [p.num, p]));
  const limit = pLimit(Math.max(1, concurrency));
  const useWorkerPool = process.env.OCR_REPAIR_USE_WORKER_POOL !== "false";
  const usePersistentWorkerPool = useWorkerPool && process.env.OCR_REPAIR_PERSISTENT_WORKERS !== "false";
  const entries = [...pageTriggers.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, options.maxPages ?? Number.POSITIVE_INFINITY);

  const jobs: OcrWorkerJob["payload"][] = [];
  for (const [pageNum, triggers] of entries) {
    const pageInfo = pageMap.get(pageNum);
    if (!pageInfo) continue;
    jobs.push({
      pdfPath: options.pdfPath,
      documentId,
      pageNum,
      triggers,
      pageInfo,
      models,
      workDir: join(workDir, `page-${pageNum}`),
      dpiPrimary: options.dpiPrimary,
      dpiFallback: options.dpiFallback,
    });
  }

  if (usePersistentWorkerPool && jobs.length > 0) {
    const result = await runWithPersistentWorkerPool(jobs, Math.max(1, concurrency));
    result.blocks.sort(compareOcrBlocks);
    return result;
  }

  await Promise.all(
    entries.map(([pageNum, triggers]) =>
      limit(async () => {
        const pageInfo = pageMap.get(pageNum);
        if (!pageInfo) return;

        const result = useWorkerPool
          ? await runOcrRepairWorker({
              pdfPath: options.pdfPath,
              documentId,
              pageNum,
              triggers,
              pageInfo,
              models,
              workDir: join(workDir, `page-${pageNum}`),
              dpiPrimary: options.dpiPrimary,
              dpiFallback: options.dpiFallback,
            })
          : await runEsearchOcrRepairPage({
              pdfPath: options.pdfPath,
              documentId,
              pageNum,
              triggers,
              pageInfo,
              models,
              workDir: join(workDir, `page-${pageNum}`),
              dpiPrimary: options.dpiPrimary,
              dpiFallback: options.dpiFallback,
            });

        blocks.push(...result.blocks);
        warnings.push(...result.warnings);
      })
    )
  );

  blocks.sort(compareOcrBlocks);

  return { blocks, warnings };
}
