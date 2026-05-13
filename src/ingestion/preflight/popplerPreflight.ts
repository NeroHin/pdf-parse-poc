import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { PreflightPageInfo } from "../types.js";

const execFileAsync = promisify(execFile);

export type PreflightResult = {
  pageCount: number;
  pageInfos: PreflightPageInfo[];
};

export function resolvePopplerBinary(name: "pdfinfo" | "pdftoppm"): string {
  const envName = name === "pdfinfo" ? "PDFINFO_PATH" : "PDFTOPPM_PATH";
  const configured = process.env[envName]?.trim();
  if (configured) return configured;

  const homebrewPath = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrewPath)) return homebrewPath;

  const localPath = new URL(
    `../../../node_modules/pdf-poppler/lib/osx/poppler-0.66/bin/${name}`,
    import.meta.url
  ).pathname;
  if (existsSync(localPath)) return localPath;

  return name;
}

function parsePageCount(output: string): number {
  const match = output.match(/^Pages:\s+(\d+)$/m);
  if (!match) {
    throw new Error("pdfinfo output did not include page count");
  }
  return Number(match[1]);
}

function parsePageInfos(output: string, pageCount: number): PreflightPageInfo[] {
  const byPage = new Map<number, PreflightPageInfo>();
  const pageSizeRe = /^Page\s+(\d+)\s+size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts\b/gm;
  let match: RegExpExecArray | null;

  while ((match = pageSizeRe.exec(output)) !== null) {
    byPage.set(Number(match[1]), {
      num: Number(match[1]),
      width: Number(match[2]),
      height: Number(match[3]),
    });
  }

  if (byPage.size === pageCount) {
    return [...byPage.values()].sort((a, b) => a.num - b.num);
  }

  const defaultSize = output.match(/^Page size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts\b/m);
  if (!defaultSize) {
    throw new Error("pdfinfo output did not include page dimensions");
  }

  const width = Number(defaultSize[1]);
  const height = Number(defaultSize[2]);
  return Array.from({ length: pageCount }, (_, i) => ({
    num: i + 1,
    width,
    height,
  }));
}

export async function popplerPreflight(filePath: string): Promise<PreflightResult> {
  const pdfinfo = resolvePopplerBinary("pdfinfo");
  const { stdout } = await execFileAsync(pdfinfo, ["-box", filePath], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const pageCount = parsePageCount(stdout);

  const fullInfo =
    pageCount > 1
      ? (
          await execFileAsync(pdfinfo, ["-box", "-f", "1", "-l", String(pageCount), filePath], {
            maxBuffer: 20 * 1024 * 1024,
          })
        ).stdout
      : stdout;

  return {
    pageCount,
    pageInfos: parsePageInfos(fullInfo, pageCount),
  };
}
