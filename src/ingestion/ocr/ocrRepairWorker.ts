import { stdin, stdout, stderr } from "node:process";
import { createInterface } from "node:readline";
import type { PreflightPageInfo } from "../types.js";
import type { OcrRepairTrigger } from "./ocrTriggers.js";
import type { ResolvedOcrModels } from "./modelPaths.js";
import { runEsearchOcrRepairPage } from "./esearchOcrRepair.js";

type WorkerInput = {
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

type PersistentJob = {
  id: number;
  payload: WorkerInput;
};

function isEpipe(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE";
}

function writeStream(stream: typeof stdout | typeof stderr, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(data, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function writeStdout(data: string): Promise<boolean> {
  try {
    await writeStream(stdout, data);
    return true;
  } catch (e) {
    if (isEpipe(e)) return false;
    throw e;
  }
}

async function writeStderr(data: string): Promise<void> {
  try {
    await writeStream(stderr, data);
  } catch (e) {
    if (!isEpipe(e)) throw e;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runOnce(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as WorkerInput;
    const result = await runEsearchOcrRepairPage(input);
    if (!(await writeStdout(JSON.stringify(result)))) process.exit(0);
  } catch (e) {
    await writeStderr(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  }
}

async function runPersistent(): Promise<void> {
  const rl = createInterface({ input: stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let id = -1;
    try {
      const job = JSON.parse(line) as PersistentJob;
      id = job.id;
      const result = await runEsearchOcrRepairPage(job.payload);
      if (!(await writeStdout(`${JSON.stringify({ id, ok: true, result })}\n`))) process.exit(0);
    } catch (e) {
      if (
        !(await writeStdout(
          `${JSON.stringify({
          id,
          ok: false,
          error: e instanceof Error ? e.stack ?? e.message : String(e),
        })}\n`
        ))
      ) {
        process.exit(0);
      }
    }
  }
}

stdout.on("error", (error) => {
  if (isEpipe(error)) process.exit(0);
  throw error;
});
stderr.on("error", (error) => {
  if (isEpipe(error)) process.exit(0);
  throw error;
});

if (process.env.OCR_WORKER_PERSISTENT === "1") {
  await runPersistent();
} else {
  await runOnce();
}
