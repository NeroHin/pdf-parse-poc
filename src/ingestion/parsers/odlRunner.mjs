#!/usr/bin/env node
/**
 * Standalone ESM runner for @opendataloader/pdf.
 * Called as a subprocess by opendataloaderAdapter.ts to avoid tsx interference.
 *
 * Usage: node odlRunner.mjs <filePath> <outputDir> [useStructTree]
 */

import { convert } from "@opendataloader/pdf";
import { mkdirSync } from "node:fs";

const [, , filePath, outputDir, useStructTreeFlag] = process.argv;

if (!filePath || !outputDir) {
  console.error("Usage: odlRunner.mjs <filePath> <outputDir> [useStructTree]");
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

await convert([filePath], {
  outputDir,
  format: "json",
  useStructTree: useStructTreeFlag === "true",
});
