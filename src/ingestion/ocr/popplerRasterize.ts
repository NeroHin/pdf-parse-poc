import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export type PopplerRasterResult = {
  pngPath: string;
  dpi: number;
  pageNum: number;
};

/**
 * Rasterize one PDF page to PNG via Poppler `pdftoppm`.
 * Output file: `{outPrefix}-{pageNum}.png`
 */
export async function rasterizePdfPagePoppler(
  pdfPath: string,
  pageNum: number,
  dpi: number,
  outDir: string,
  basename: string
): Promise<PopplerRasterResult> {
  mkdirSync(outDir, { recursive: true });

  const pdftoppm =
    process.env.PDFTOPPM_PATH ??
    (existsSync("/opt/homebrew/bin/pdftoppm") ? "/opt/homebrew/bin/pdftoppm" : "pdftoppm");

  const outPrefix = join(outDir, basename);

  await execFileAsync(pdftoppm, [
    "-png",
    "-r",
    String(dpi),
    "-f",
    String(pageNum),
    "-l",
    String(pageNum),
    pdfPath,
    outPrefix,
  ]);

  const pngPath = `${outPrefix}-${pageNum}.png`;
  if (!existsSync(pngPath)) {
    throw new Error(`pdftoppm did not produce ${pngPath}`);
  }

  return { pngPath, dpi, pageNum };
}
