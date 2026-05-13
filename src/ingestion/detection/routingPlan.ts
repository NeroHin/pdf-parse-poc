import type {
  PageDetection,
  PdfParseHint,
  ParserRoutingPlan,
  ParserRoutingEntry,
} from "../types.js";

type PageGroup = {
  pages: number[];
  parserRecommendation: PageDetection["parserRecommendation"];
  allPagesHaveGoodNativeText: boolean;
  hasLowNativeTextQuality: boolean;
};

function groupContiguousPages(detections: PageDetection[]): PageGroup[] {
  if (detections.length === 0) return [];

  const groups: PageGroup[] = [];
  let currentGroup: PageGroup = {
    pages: [detections[0].page],
    parserRecommendation: detections[0].parserRecommendation,
    allPagesHaveGoodNativeText:
      detections[0].parserRecommendation === "pdfjs",
    hasLowNativeTextQuality:
      detections[0].parserRecommendation !== "pdfjs",
  };

  for (let i = 1; i < detections.length; i++) {
    const d = detections[i];
    if (d.parserRecommendation === currentGroup.parserRecommendation) {
      currentGroup.pages.push(d.page);
      if (d.parserRecommendation !== "pdfjs") {
        currentGroup.allPagesHaveGoodNativeText = false;
      }
      if (d.parserRecommendation === "pdfjs") {
        currentGroup.hasLowNativeTextQuality = false;
      }
    } else {
      groups.push(currentGroup);
      currentGroup = {
        pages: [d.page],
        parserRecommendation: d.parserRecommendation,
        allPagesHaveGoodNativeText: d.parserRecommendation === "pdfjs",
        hasLowNativeTextQuality: d.parserRecommendation !== "pdfjs",
      };
    }
  }
  groups.push(currentGroup);

  return groups;
}

export function buildRoutingPlan(
  detections: PageDetection[],
  hint: PdfParseHint
): ParserRoutingPlan {
  const groups = groupContiguousPages(detections);

  return groups.map((group): ParserRoutingEntry => {
    if (hint.forceOcr && group.hasLowNativeTextQuality) {
      return {
        pages: group.pages,
        parser: "opendataloader_hybrid",
        reason: "hint_plus_detection",
      };
    }

    if (hint.forceNativeText && group.allPagesHaveGoodNativeText) {
      return {
        pages: group.pages,
        parser: "pdfjs",
        reason: "hint_allowed_by_detection",
      };
    }

    return {
      pages: group.pages,
      parser: group.parserRecommendation,
      reason: "system_detection",
    };
  });
}

export function buildRoutingWarnings(
  detections: PageDetection[],
  plan: ParserRoutingPlan,
  hint: PdfParseHint
): string[] {
  const warnings: string[] = [];

  if (hint.forceNativeText) {
    const nonNativePages = detections
      .filter((d) => d.parserRecommendation !== "pdfjs")
      .map((d) => d.page);
    if (nonNativePages.length > 0) {
      warnings.push(
        `使用者要求強制原生文字模式，但系統偵測第 ${nonNativePages.join(", ")} 頁不適合原生解析，已依系統偵測覆蓋。`
      );
    }
  }

  if (hint.forceOcr) {
    const nativePages = detections
      .filter((d) => d.parserRecommendation === "pdfjs")
      .map((d) => d.page);
    if (nativePages.length > 0) {
      warnings.push(
        `使用者要求強制 OCR 模式，但系統偵測第 ${nativePages.join(", ")} 頁有可用原生文字層。`
      );
    }
  }

  for (const entry of plan) {
    const suspectedPages = entry.pages.filter((p) => {
      const d = detections.find((dd) => dd.page === p);
      return d?.suspectedHiddenOrOffPageText || d?.suspectedGarbledText;
    });
    if (suspectedPages.length > 0) {
      warnings.push(
        `第 ${suspectedPages.join(", ")} 頁偵測到 hidden/off-page 或亂碼文字風險，已路由至安全過濾路徑。`
      );
    }
  }

  return warnings;
}
