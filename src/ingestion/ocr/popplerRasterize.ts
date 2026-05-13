import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePopplerBinary } from "../preflight/popplerPreflight.js";

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

  const pdftoppm = resolvePopplerBinary("pdftoppm");

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

  const expected = `${outPrefix}-${pageNum}.png`;
  const padded = join(outDir, `${basename}-${String(pageNum).padStart(2, "0")}.png`);
  const produced =
    [expected, padded].find((p) => existsSync(p)) ??
    readdirSync(outDir)
      .filter((name) => name.startsWith(`${basename}-`) && name.endsWith(".png"))
      .map((name) => join(outDir, name))
      .sort()[0];

  const pngPath = produced ?? expected;
  if (!existsSync(pngPath)) {
    throw new Error(`pdftoppm did not produce ${pngPath}`);
  }

  return { pngPath, dpi, pageNum };
}
