/**
 * Arabic-aware text normalization for product/variant search.
 * Handles: alef variants, taa marbuta, yaa/alef-maqsura, diacritics,
 * common Egyptian misspellings (تيشيرت/تيشرت), tatweel, punctuation.
 */

const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

export function normalizeArabic(input: string): string {
  let s = (input ?? "").toLowerCase().trim();
  s = s.replace(DIACRITICS, "");
  s = s.replace(/[أإآٱ]/g, "ا");
  s = s.replace(/ة/g, "ه");
  s = s.replace(/ى/g, "ي");
  s = s.replace(/ؤ/g, "و");
  s = s.replace(/ئ/g, "ي");
  // remove tatweel + normalize whitespace/punctuation
  s = s.replace(/ـ/g, "");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Bilingual synonym groups (canonical first). Both the query and the catalog
 * go through expandAliases, so every synonym converges on the canonical form
 * regardless of which language the product was named in — "Sneakers" matches
 * "عايز كوتشي", "قميص" matches "Classic White Shirt". ⚠ JS `\b` does NOT
 * work around Arabic letters (Arabic is non-`\w`), so replacement uses
 * Unicode letter/number boundaries instead.
 */
const SYNONYM_GROUPS: string[][] = [
  ["تيشيرت", "t-shirt", "tshirt", "t shirt", "tee"],
  ["اوفرسايز", "oversized", "over size", "اوفر سايز"],
  ["هودي", "hoodie", "hoody"],
  ["سويت شيرت", "سويتشيرت", "sweatshirt", "sweat shirt"],
  ["كارجو", "cargo"],
  ["جينز", "jeans", "denim", "جينزيه", "جينزية"],
  ["قميص", "shirt"],
  ["بنطلون", "بنطال", "بنطلونات", "pants", "trousers", "levis"],
  ["شورت", "شورتات", "shorts", "short"],
  ["جاكيت", "جاكته", "جاكت", "jacket", "jackets", "blazer", "بليزر"],
  ["بلوفر", "بلوزه", "بلوزة", "سويتر", "sweater", "jumper", "pullover", "كنزه", "كنزته", "كنزة"],
  ["كوتشي", "جزمة", "جزمه", "حذاء", "حذاه", "shoe", "shoes", "sneaker", "sneakers", "trainers"],
  ["كاب", "طاقيه", "طاقية", "cap", "caps", "hat", "hats"],
  ["شنطه", "شنطة", "حقيبه", "حقيبة", "bag", "bags"],
  ["كوره", "كورة", "كره", "كرة", "football", "soccer", "ball"],
  ["جلباب", "جلابيه", "جلابية", "galabeya", "galabeyah", "galabia"],
  ["شبشب", "سندل", "صندل", "slipper", "slippers", "sandal", "sandals", "flip flops", "flip-flops"],
  ["حجاب", "hijab", "طرحه", "طرحة"],
  ["شال", "شالات", "scarf", "scarves", "اسكارف"],
  ["ساعه", "ساعة", "watch", "watches"],
  ["عبايه", "عباية", "عبايات", "abaya"],
  ["اكسسوار", "اكسسوارات", "accessory", "accessories"],
  ["رياضه", "رياضة", "sport", "sports"],
  ["شتوي", "شتويه", "شتوية", "winter"],
  ["صيفي", "صيفيه", "صيفية", "summer"],
  ["قطن", "cotton", "قطنيه", "قطنية"],
  ["كتان", "linen", "لينن"],
  ["جلد", "جلدي", "جلديه", "جلدية", "leather", "ليذر"],
  ["حرير", "silk", "سيلك"],
  ["صوف", "wool"],
];

const RE_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const esc = (s: string) => s.replace(RE_SPECIALS, "\\$&").replace(/\s+/g, "\\s+");

/** Unicode-boundary word match so Arabic words work (unlike `\b`). */
function synonymPattern(words: string[]): RegExp {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}])(${sorted.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "gu");
}

const GROUP_PATTERNS = SYNONYM_GROUPS.map(([canonical, ...syns]) => [canonical, synonymPattern(syns)] as const);

export function expandAliases(input: string): string {
  let s = ` ${input} `;
  for (const [canonical, re] of GROUP_PATTERNS) s = s.replace(re, ` ${canonical} `);
  return s.replace(/\s+/g, " ").trim();
}

/** Tokens that carry no product signal (Egyptian dialect + MSA + English). */
export const SEARCH_STOPWORDS = new Set(
  [
    "عايز", "عاوز", "عايزه", "عايزين", "عاوزين", "محتاج", "بدور", "ادور",
    "عندكم", "عندك", "عندكو", "فيه", "في", "موجود", "موجوده", "موجودين",
    "متوفر", "متوفره", "متوفرين", "متاح", "متاحة", "متاحين",
    "هل",
    "هو", "هي", "هم", "هن", "انت", "انتي", "انتم", "انتو", "احنا",
    "بكام", "بكم", "سعر", "سعره", "اسعار", "كام",
    "مقاس", "مقاسات", "لون", "الوان", "الون",
    "لو", "سمحت", "ممكن", "انا", "ايه", "اي", "الي", "اللي", "ده", "دي", "دا", "دول",
    "عشان", "كده", "يعني", "تمام", "اه", "ايوه", "شكرا", "سلام", "عليكم",
    "hello", "hi", "hey", "please", "price", "how", "much", "is", "there", "have", "got",
    "السلام", "عليكم",
  ].map((w) => normalizeArabic(w))
);

/**
 * Arabic plural/affix stems as EXTRA variants (original always kept, so both
 * sides stem consistently): تيشيرتات→تيشيرت، جينزات→جينز، مقاسات→مقاس،
 * لاعبين→لاعب. Length guards keep short words (بنات، عين) intact.
 */
export function stemArabicToken(tok: string): string[] {
  const out = [tok];
  const push = (s: string, min: number) => {
    if (s.length >= min && s !== tok && !out.includes(s)) out.push(s);
  };
  if (tok.endsWith("ات")) push(tok.slice(0, -2), 3);
  if (tok.endsWith("ين") || tok.endsWith("ون")) push(tok.slice(0, -2), 4);
  return out;
}

/**
 * Tokenize for retrieval: normalized tokens plus ال-stripped variants
 * ("التيشيرت" → {"التيشيرت","تيشيرت"}) so the definite article never
 * blocks a match. No stopword removal here — callers decide.
 */
export function searchTokens(input: string): string[] {
  const out: string[] = [];
  for (const tok of normalizeSearchText(input).split(" ").filter(Boolean)) {
    out.push(tok);
    if (tok.startsWith("ال") && tok.length >= 5) {
      const stripped = tok.slice(2);
      if (stripped.length >= 2 && stripped !== tok) out.push(stripped);
    }
    // Attached prepositions/conjunctions: "للقاهرة" → "قاهرة",
    // "بالأسود" → "اسود". Both forms kept; length guards prevent merging
    // short unrelated words.
    if (tok.length >= 6) {
      const dePrefixed = tok.replace(/^[لوبكف]+/, "");
      if (dePrefixed.length >= 3 && dePrefixed !== tok) {
        out.push(dePrefixed);
        if (dePrefixed.startsWith("ال") && dePrefixed.length >= 5) {
          const doubly = dePrefixed.slice(2);
          if (doubly.length >= 2) out.push(doubly);
        }
      }
    }
  }
  // Second pass: canonical variants of isolated tokens. The full-string pass
  // can't see synonyms fused with the definite article ("الجاكت" stays
  // "الجاكت"), so each emitted token is expanded alone too — that yields the
  // canonical "جاكيت" on the query side to match the canonicalized haystack.
  const base = [...new Set(out)];
  for (const t of [...base]) {
    for (const s of expandAliases(t).split(" ").filter(Boolean)) {
      if (s && !base.includes(s)) base.push(s);
    }
  }
  // Third pass: plural stems for every emitted form (covers ال-stripped
  // plurals like التيشيرتات → تيشيرت too).
  for (const t of [...base]) for (const s of stemArabicToken(t)) if (!base.includes(s)) base.push(s);
  return base;
}

/** Product-signal tokens: stripped of stopwords. Empty => no product intent. */
export function signalTokens(input: string): string[] {
  return searchTokens(input).filter((t) => !SEARCH_STOPWORDS.has(t) && t.length >= 1);
}

/** Recall-oriented score: how much of the query's product signal a haystack covers. */
export function recallScore(queryTokens: string[], hayTokens: Set<string>): number {
  if (queryTokens.length === 0) return 0;
  let hit = 0;
  for (const t of queryTokens) if (hayTokens.has(t)) hit++;
  return hit / queryTokens.length;
}

/** Optional one-character insertion/deletion (Egyptian orthographic drift:
 * "جاكت" ↔ "جاكيت"). Only meaningful for longer tokens. */
export function editWithin1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i++;
      j++;
    } else if (a.length > b.length) {
      i++;
    } else {
      j++;
    }
  }
  return edits + Math.abs(a.length - i - (b.length - j)) <= 1;
}

/**
 * Tolerant token hit: exact match, or a shared prefix long enough to rule
 * out coincidence (هوديز↔هودي، تيشيرتات↔تيشيرت even without stemming), or a
 * one-character edit (جاكت↔جاكيت). Short tokens stay exact-only.
 */
export function tokenMatches(q: string, hayTokens: Set<string>): boolean {
  if (hayTokens.has(q)) return true;
  if (q.length < 4) return false;
  for (const h of hayTokens) {
    if (h.length < 4) continue;
    if (h.startsWith(q) || q.startsWith(h)) return true;
    if (editWithin1(q, h)) return true;
  }
  return false;
}

/** Recall with tolerant matching (see tokenMatches). */
export function scoreTokenRecall(queryTokens: string[], hayTokens: Set<string>): number {
  if (queryTokens.length === 0) return 0;
  let hit = 0;
  for (const t of queryTokens) if (tokenMatches(t, hayTokens)) hit++;
  return hit / queryTokens.length;
}

export function normalizeSearchText(input: string): string {
  return expandAliases(normalizeArabic(input));
}

/** Size synonyms. Order matters: XXL > XL > L (e.g. "اكس لارج" contains "لارج"). */
const SIZE_RULES: Array<{ latin?: RegExp; ar: string[]; en?: string[]; size: string }> = [
  { latin: /\b(xxl|2xl)\b/, ar: ["دبل اكس"], size: "XXL" },
  { latin: /\bxl\b|extra large/, ar: ["اكس لارج"], size: "XL" },
  { latin: /\bl\b|large/, ar: ["لارج"], size: "L" },
  { latin: /\bm\b|medium/, ar: ["ميديم", "وسط"], size: "M" },
  { latin: /\bs\b|small/, ar: ["سمول", "صغير"], size: "S" },
];

export function normalizeSizeToken(input: string): string | null {
  const n = normalizeSearchText(input);
  const padded = ` ${n} `;
  for (const rule of SIZE_RULES) {
    if (rule.latin && rule.latin.test(padded)) return rule.size;
    if (rule.ar.some((w) => padded.includes(` ${normalizeArabic(w)} `))) return rule.size;
  }
  // bare single letters
  const bare = n.toUpperCase().replace(/\s+/g, "");
  if (["S", "M", "L", "XL", "XXL"].includes(bare)) return bare;
  return null;
}

/** Color synonyms AR/EN -> canonical English color name used in seed data. */
const COLOR_MAP: Array<[RegExp, string]> = [
  [/(اسود|بلاك|black|aswad)/, "Black"],
  [/(ابيض|وايت|white|abyad|abyed)/, "White"],
  [/(بيج|beige)/, "Beige"],
  [/(ازرق|كحلي|blue|navy|azra2|azraq)/, "Blue"],
  [/(احمر|red|ahmar)/, "Red"],
  [/(اخضر|green|akhdar)/, "Green"],
  [/(رمادي|رصاصي|grey|gray)/, "Grey"],
];

export function normalizeColorToken(input: string): string | null {
  const n = normalizeSearchText(input);
  for (const [re, color] of COLOR_MAP) {
    if (re.test(n)) return color;
  }
  return null;
}

/** Extract quantity hints: "عايز اتنين" -> 2, "x2" -> 2, "٢" -> 2. */
const ARABIC_NUMBERS: Record<string, number> = {
  واحد: 1, واحده: 1, واحدة: 1,
  اتنين: 2, اثنين: 2, اثنان: 2,
  تلاته: 3, ثلاثة: 3,
  اربعه: 4, أربعة: 4,
  خمسه: 5, خمسة: 5,
};

export function extractQuantity(input: string): number | null {
  const n = normalizeSearchText(input);
  const digit = n.match(/(?:x|×)?\s*(\d{1,2})\b/);
  if (digit) {
    const q = parseInt(digit[1], 10);
    if (q >= 1 && q <= 99) return q;
  }
  // Arabic-Indic digits
  const arDigit = input.match(/[٠-٩]{1,2}/);
  if (arDigit) {
    const val = arDigit[0].split("").reduce((acc, ch) => acc * 10 + ("٠١٢٣٤٥٦٧٨٩".indexOf(ch)), 0);
    if (val >= 1 && val <= 99) return val;
  }
  for (const [word, val] of Object.entries(ARABIC_NUMBERS)) {
    if (n.includes(normalizeArabic(word))) return val;
  }
  return null;
}

/** Simple token-overlap score 0..1 for fuzzy product matching. */
export function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeSearchText(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeSearchText(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export function wantsHuman(text: string): boolean {
  return (
    /عايز اكلم|عاوز اكلم|كلم.*حد|انسان|بشري|موظف|خدمة العملاء|talk to|human|real person|support agent/i.test(
      text
    )
  );
}

export function isConfirmation(text: string): boolean {
  const n = normalizeSearchText(text);
  const words = new Set(n.split(" "));
  const CONFIRM_NORM = ["اكد", "اكد الاوردر", "تمام", "ماشي", "اوك", "موافق", "ايوه", "اه", "نعم", "yes", "confirm", "ok", "okay"];
  if (CONFIRM_NORM.some((w) => n === w || n.includes(w))) return true;
  void words;
  return false;
}

export function isCancellation(text: string): boolean {
  const n = normalizeSearchText(text);
  return n.includes("الغي") || n.includes("الغاء") || n.includes("بلاش") || n.includes("مش عايز") || /\bcancel\b/.test(n);
}

/** Arabic-Indic digits → latin (١٨٠ -> 180). */
export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function firstInt(match: RegExpMatchArray | null, group = 1): number | null {
  if (!match?.[group]) return null;
  const v = parseInt(match[group], 10);
  return Number.isFinite(v) ? v : null;
}

export interface BodyMetrics {
  heightCm: number | null;
  weightKg: number | null;
  chestCm: number | null;
  fit: "slim" | "regular" | "oversized" | null;
}

/** Extract body metrics from Arabic/English text (heights 100-230cm, weights 30-300kg, chest 50-200cm). */
export function extractBodyMetrics(text: string): BodyMetrics {
  const t = ` ${toLatinDigits(text)} `;
  let heightCm: number | null =
    firstInt(t.match(/طول[يى]?\s*(\d{2,3})/)) ??
    firstInt(t.match(/(\d{2,3})\s*(cm|سم|سنتيمتر)/i)) ??
    firstInt(t.match(/height\s*(is\s*)?(\d{2,3})/i), 2);
  if (heightCm != null && (heightCm < 100 || heightCm > 230)) heightCm = null;

  let weightKg: number | null =
    firstInt(t.match(/وزن[يى]?\s*(\d{2,3})/)) ??
    firstInt(t.match(/(\d{2,3})\s*(kg|kilo|كيلو)/i)) ??
    firstInt(t.match(/weight\s*(is\s*)?(\d{2,3})/i), 2);
  if (weightKg != null && (weightKg < 30 || weightKg > 300)) weightKg = null;

  let chestCm: number | null =
    firstInt(t.match(/(محيط\s*)?الصدر\s*(\d{2,3})/), 2) ??
    firstInt(t.match(/chest\s*(\d{2,3})/i)) ??
    firstInt(t.match(/(\d{2,3})\s*chest/i));
  if (chestCm != null && (chestCm < 50 || chestCm > 200)) chestCm = null;

  const n = normalizeSearchText(text);
  const fit =
    /(واسع|فضفاض|اوفرسايز|oversized|over size|loose|baggy)/.test(n) ? ("oversized" as const)
    : /(ضيق|محزق|ماسك|slim|tight|skinny)/.test(n) ? ("slim" as const)
    : /(عادي|مظبوط|ريجولر|regular|normal)/.test(n) ? ("regular" as const)
    : null;

  return { heightCm, weightKg, chestCm, fit };
}

export function hasBodyMetrics(text: string): boolean {
  const m = extractBodyMetrics(text);
  return m.heightCm != null || m.weightKg != null || m.chestCm != null;
}

/**
 * Size-ADVICE intent ("which size should I take?") vs size SELECTION
 * ("size L"). Advice = question words about size, or body metrics without
 * an explicit size mention.
 */
export function isSizeAdvice(text: string): boolean {
  const n = normalizeSearchText(text);
  if (/(مقاس(ي|ى)?\s*(ايه|اختار|اختاري|المناسب|الانسب|الامثل|الافضل|اخد))|(ايه|انهي|اني)\s*(المقاس|مقاس)/.test(n)) return true;
  if (/(what|which)\s+size|size\s+(recommend|advice|guide|should|for me)/i.test(text)) return true;
  if (hasBodyMetrics(text) && !normalizeSizeToken(text)) return true;
  return false;
}

/** Explicit size-memory opt-in ("my size is always L", "مقاسي L دايما"). */
export function extractRememberedSize(text: string): string | null {
  const n = normalizeSearchText(text);
  if (!/(مقاسي|مقاس المفضل|مقاس الدائم|my size is|always.*size|size.*always)/.test(n)) return null;
  return normalizeSizeToken(text);
}

/**
 * Offer/discount intent ("في خصم؟", "any promo?"). Single source for the
 * planner and the orchestrator so both agree on what counts.
 */
export function isPromoQuestion(text: string): boolean {
  const n = normalizeSearchText(text);
  // Unambiguous discount words may match as substrings.
  if (/(خصم|خصومات|تخفيض|تخفيضات|كوبون|كوبونات|برومو)/.test(n)) return true;
  // عرض/عروض/قسيمه only as standalone tokens: "اعرضلي" (show me) is NOT an offer.
  const padded = ` ${n} `;
  if ([" عرض ", " عروض ", " قسيمه ", " العرض ", " العروض "].some((w) => padded.includes(w))) return true;
  if (/(promo|discount|coupon|offers?|deals?|\bsale\b|\bvoucher\b)/i.test(text)) return true;
  return false;
}
