declare module "esearch-ocr" {
  export function setOCREnv(opts: {
    canvas?: (w: number, h: number) => unknown;
    imageData?: (data: Uint8ClampedArray, w: number, h: number) => ImageData;
    dev?: boolean;
    log?: boolean;
  }): void;

  export function analyzeLayout(src: unknown, opts?: unknown): unknown;

  export function init(opts: unknown): Promise<{
    ocr: (src: unknown) => Promise<{
      parragraphs?: Array<{
        text: string;
        mean: number;
        box: [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ];
      }>;
      columns?: unknown[];
      readingDir?: unknown;
      angle?: unknown;
      src?: unknown;
    }>;
  }>;
}
