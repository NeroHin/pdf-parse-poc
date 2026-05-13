import type { OdlJsonItem } from "../types.js";

const SKIP_TYPES = new Set(["footer", "header", "image", "picture"]);

function isEmptyTable(item: OdlJsonItem): boolean {
  if (item.type.toLowerCase() !== "table") return false;
  const rows = item.rows;
  if (rows === undefined || rows === null) return true;
  if (Array.isArray(rows) && rows.length === 0) return true;
  return false;
}

/** True if ODL kept this block but it has no usable text/table payload. */
export function isStructuralHoleItem(item: OdlJsonItem): boolean {
  const t = item.type.toLowerCase();
  if (SKIP_TYPES.has(t)) return false;
  if (item.content?.trim()) return false;
  if (t === "table") return isEmptyTable(item);
  return true;
}

export function pagesWithStructuralHoles(items: OdlJsonItem[]): Set<number> {
  const pages = new Set<number>();
  for (const item of items) {
    if (isStructuralHoleItem(item)) {
      pages.add(item["page number"]);
    }
  }
  return pages;
}
