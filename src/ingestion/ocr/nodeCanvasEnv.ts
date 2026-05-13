import { createCanvas, ImageData as CanvasImageData } from "@napi-rs/canvas";
import { setOCREnv } from "esearch-ocr";

let installed = false;

/** Required for esearch-ocr on Node (canvas + ImageData). Call before init(). */
export function ensureEsearchNodeCanvasEnv(): void {
  if (installed) return;
  setOCREnv({
    canvas: (w: number, h: number) => createCanvas(w, h),
    imageData: (data: Uint8ClampedArray, w: number, h: number) =>
      new CanvasImageData(data, w, h) as any,
  });
  installed = true;
}
