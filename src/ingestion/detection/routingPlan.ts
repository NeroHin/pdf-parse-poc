import type {
  PageDetection,
  PdfParseHint,
  ParserRoutingPlan,
  ParserRoutingEntry,
} from "../types.js";

type PageGroup = {
  pages: number[];
  parserRecommendation: PageDetection["parserRecommendation"];
  hasLowNativeTextQuality: boolean;
};

function groupContiguousPages(detections: PageDetection[]): PageGroup[] {
  if (detections.length === 0) return [];

  const groups: PageGroup[] = [];
  let currentGroup: PageGroup = {
    pages: [detections[0].page],
    parserRecommendation: detections[0].parserRecommendation,
    hasLowNativeTextQuality:
      detections[0].parserRecommendation !== "opendataloader_default",
  };

  for (let i = 1; i < detections.length; i++) {
    const d = detections[i];
    if (d.parserRecommendation === currentGroup.parserRecommendation) {
      currentGroup.pages.push(d.page);
      if (d.parserRecommendation === "opendataloader_default") {
        currentGroup.hasLowNativeTextQuality = false;
      }
    } else {
      groups.push(currentGroup);
      currentGroup = {
        pages: [d.page],
        parserRecommendation: d.parserRecommendation,
        hasLowNativeTextQuality: d.parserRecommendation !== "opendataloader_default",
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
    warnings.push("目前後端已固定使用 OpenDataLoader；原生文字解析偏好只保留為輸入紀錄，不會切換 parser。");
  }

  if (hint.forceOcr) {
    warnings.push("目前 OCR 僅作 OpenDataLoader 後的 page-level repair；不會取代 ODL 主解析。");
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
