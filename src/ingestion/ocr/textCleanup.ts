import { OpenCC } from "opencc";

export type TextCleanupFix = {
  type: "opencc" | "ocr_confusion" | "whitespace" | "punctuation";
  before: string;
  after: string;
};

export type TextCleanupResult = {
  text: string;
  originalText: string;
  fixes: TextCleanupFix[];
  openccConfig?: "s2tw.json";
};

const converter = new OpenCC("s2tw.json");

const OCR_CONFUSIONS: [RegExp, string][] = [
  [/竞争力/g, "競爭力"],
  [/决策/g, "決策"],
  [/虚擬/g, "虛擬"],
  [/惠用/g, "應用"],
  [/典應用/g, "與應用"],
  [/典息用/g, "與應用"],
  [/典深耕/g, "與深耕"],
  [/典社/g, "與社"],
  [/典促進/g, "與促進"],
  [/典引/g, "與引"],
  [/技街/g, "技術"],
  [/技術息用典/g, "技術應用與"],
  [/積櫃/g, "積極"],
  [/收国/g, "攸關"],
  [/收國國家帶展/g, "攸關國家發展"],
  [/国民/g, "國民"],
  [/国家/g, "國家"],
  [/帶展/g, "發展"],
  [/福社/g, "福祉"],
  [/永績/g, "永續"],
  [/尊量/g, "尊嚴"],
  [/发/g, "發"],
  [/孩系统/g, "該系統"],
  [/孩系統/g, "該系統"],
  [/目操/g, "目標"],
  [/虚报/g, "虛擬"],
  [/虛報/g, "虛擬"],
  [/威测/g, "感測"],
  [/接器/g, "機器"],
  [/封於/g, "對於"],
  [/爱制定/g, "爰制定"],
  [/愛制定/g, "爰制定"],
  [/指揉/g, "指標"],
  [/引尊/g, "引導"],
  [/基硅/g, "基礎"],
  [/海登展/g, "為發展"],
  [/回鹰/g, "回應"],
  [/回鷹/g, "回應"],
  [/鷹用/g, "應用"],
  [/社合/g, "社會"],
  [/揉準/g, "標準"],
  [/重工/g, "電工"],
  [/规範/g, "規範"],
  [/规定/g, "規定"],
  [/惠法/g, "憲法"],
  [/影率/g, "影響"],
  [/威測/g, "感測"],
  [/選過/g, "透過"],
  [/預測內容建或決策/g, "預測、內容、建議或決策"],
  [/AI 會管理框架/g, "AI 風險管理框架"],
  [/明確或医含/g, "明確或隱含"],
  [/医含/g, "隱含"],
  [/醫含/g, "隱含"],
];

const ENGLISH_PHRASE_FIXES: [RegExp, string][] = [
  [/NationalAI/g, "National AI"],
  [/InitiativeActof/g, "Initiative Act of"],
  [/InitiativeAct/g, "Initiative Act"],
  [/ArtificialIntelligence/g, "Artificial Intelligence"],
  [/RiskManagementFramework/g, "Risk Management Framework"],
  [/RiskManagement/g, "Risk Management"],
  [/NationalInstituteof/g, "National Institute of"],
  [/StandardsandTechnology/g, "Standards and Technology"],
  [/U\.SCode/g, "U.S. Code"],
  [/suchas/g, "such as"],
  [/withvarying/g, "with varying"],
  [/predictions,content/g, "predictions, content"],
  [/recommendations,or/g, "recommendations, or"],
];

function recordReplace(
  text: string,
  type: TextCleanupFix["type"],
  pattern: RegExp,
  replacement: string,
  fixes: TextCleanupFix[]
): string {
  const before = text;
  const after = text.replace(pattern, replacement);
  if (after !== before) fixes.push({ type, before, after });
  return after;
}

function normalizeWhitespace(text: string, fixes: TextCleanupFix[]): string {
  let out = text;
  for (const [pattern, replacement] of ENGLISH_PHRASE_FIXES) {
    out = recordReplace(out, "whitespace", pattern, replacement, fixes);
  }
  out = recordReplace(out, "whitespace", /([\p{Script=Han}])\s+([\p{Script=Han}])/gu, "$1$2", fixes);
  out = recordReplace(out, "whitespace", /\s+([，。；：、！？）】])/g, "$1", fixes);
  out = recordReplace(out, "whitespace", /([（【])\s+/g, "$1", fixes);
  out = recordReplace(out, "whitespace", /([A-Za-z])([\p{Script=Han}])/gu, "$1 $2", fixes);
  out = recordReplace(out, "whitespace", /([\p{Script=Han}])([A-Za-z]{2,})/gu, "$1 $2", fixes);
  out = recordReplace(out, "whitespace", /\s{2,}/g, " ", fixes);
  return out.trim();
}

function normalizePunctuation(text: string, fixes: TextCleanupFix[]): string {
  let out = text;
  out = recordReplace(out, "punctuation", /([\p{Script=Han}])·([\p{Script=Han}])/gu, "$1，$2", fixes);
  out = recordReplace(out, "punctuation", /([一二三四五六七八九十])[:：]/g, "$1、", fixes);
  out = recordReplace(out, "punctuation", /([\p{Script=Han}])[:：]([\p{Script=Han}])/gu, "$1，$2", fixes);
  out = recordReplace(out, "punctuation", /，([）】])/g, "$1", fixes);
  out = recordReplace(out, "punctuation", /([。！？；])([^\s\n])/g, "$1$2", fixes);
  out = recordReplace(out, "punctuation", /（\s*([A-Za-z])/g, "（$1", fixes);
  out = recordReplace(out, "punctuation", /([A-Za-z])\s*）/g, "$1）", fixes);
  return out;
}

export async function normalizeOcrText(text: string): Promise<TextCleanupResult> {
  const originalText = text;
  const fixes: TextCleanupFix[] = [];

  let out = await converter.convertPromise(text);
  if (out !== text) fixes.push({ type: "opencc", before: text, after: out });

  for (const [pattern, replacement] of OCR_CONFUSIONS) {
    out = recordReplace(out, "ocr_confusion", pattern, replacement, fixes);
  }

  out = normalizeWhitespace(out, fixes);
  out = normalizePunctuation(out, fixes);

  return {
    text: out,
    originalText,
    fixes,
    openccConfig: "s2tw.json",
  };
}
