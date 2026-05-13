import { createWriteStream, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";

const TMP_DIR = resolve(process.cwd(), "tmp");
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

export function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

export function cleanStaleFiles(): void {
  if (!existsSync(TMP_DIR)) return;
  const now = Date.now();
  for (const file of readdirSync(TMP_DIR)) {
    const filePath = join(TMP_DIR, file);
    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }
}

export async function saveUploadedFile(
  file: MultipartFile,
  documentId: string
): Promise<string> {
  ensureTmpDir();
  const filePath = join(TMP_DIR, `${documentId}.pdf`);
  const writeStream = createWriteStream(filePath);
  await pipeline(file.file, writeStream);
  return filePath;
}

export function getUploadedFilePath(documentId: string): string {
  return join(TMP_DIR, `${documentId}.pdf`);
}
