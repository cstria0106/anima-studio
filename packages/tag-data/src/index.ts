export interface OfflineTag {
  tag: string;
  category: "general" | "artist" | "character" | "copyright" | "meta";
  count: number;
  description: string;
  aliases?: readonly string[];
}

export interface OfflineTagCooccurrence {
  tag: string;
  relatedTag: string;
  count: number;
}

export const DANBOORU_CATEGORY_NAMES = {
  "0": "general",
  "1": "artist",
  "3": "copyright",
  "4": "character",
  "5": "meta",
} as const;

export function normalizeDanbooruTag(value: string): string {
  const unescaped = value
    .replaceAll("\\(", "(")
    .replaceAll("\\)", ")")
    .trim();
  if (/^score_[1-9]$/i.test(unescaped)) return unescaped.toLowerCase();
  if (unescaped.includes("_") && !/[\p{L}\p{N}]/u.test(unescaped)) {
    return unescaped;
  }
  return unescaped.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

/** Escapes literal tag parentheses without changing user-authored weights. */
export function escapeDanbooruTagForPrompt(value: string): string {
  return normalizeDanbooruTag(value)
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

/**
 * Parses one RFC 4180-style row. The upstream autocomplete data does not use
 * multiline fields, so keeping this line-oriented lets the API import large
 * datasets without loading the whole source file into memory.
 */
export function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      values.push(value);
      value = "";
      continue;
    }
    value += character;
  }
  values.push(value);
  return values;
}

export function parseDanbooruTagRow(
  fields: readonly string[],
): OfflineTag | null {
  const rawTag = fields[0]?.trim() ?? "";
  const categoryCode = fields[1]?.trim() ?? "";
  const count = Number.parseInt(fields[2]?.trim() ?? "", 10);
  if (!rawTag || !Number.isSafeInteger(count) || count < 0) return null;

  const tag = normalizeDanbooruTag(rawTag);
  const category =
    DANBOORU_CATEGORY_NAMES[
      categoryCode as keyof typeof DANBOORU_CATEGORY_NAMES
    ] ?? "general";
  const aliases = [
    ...new Set(
      (fields[3] ?? "")
        .split(",")
        .map(normalizeDanbooruTag)
        .filter((alias) => alias && alias !== tag),
    ),
  ];

  return {
    tag,
    category,
    count,
    description: "",
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

export function parseDanbooruCooccurrenceRow(
  fields: readonly string[],
): OfflineTagCooccurrence | null {
  const tag = normalizeDanbooruTag(fields[0] ?? "");
  const relatedTag = normalizeDanbooruTag(fields[1] ?? "");
  const numericCount = Number(fields[2]?.trim() ?? "");
  if (
    !tag ||
    !relatedTag ||
    tag === relatedTag ||
    !Number.isFinite(numericCount) ||
    numericCount < 0
  ) {
    return null;
  }
  return { tag, relatedTag, count: Math.floor(numericCount) };
}

const general = (tag: string, count: number, description = ""): OfflineTag => ({
  tag,
  category: "general",
  count,
  description,
});

const meta = (tag: string, count: number, description = ""): OfflineTag => ({
  tag,
  category: "meta",
  count,
  description,
});

export const ANIMA_CURATED_TAGS: readonly OfflineTag[] = [
  meta("masterpiece", 4_000_000, "최고 수준의 완성도를 지향하는 품질 태그"),
  meta("best quality", 3_500_000, "매우 높은 품질을 지향하는 태그"),
  meta("good quality", 2_000_000, "좋은 품질을 지향하는 태그"),
  meta("normal quality", 1_000_000, "보통 품질을 지향하는 태그"),
  meta("low quality", 2_300_000, "낮은 품질을 나타내는 태그"),
  meta("worst quality", 2_000_000, "매우 낮은 품질을 나타내는 태그"),
  ...Array.from({ length: 9 }, (_, index) =>
    meta(
      `score_${index + 1}`,
      1_000_000,
      `Anima 미학 점수 ${index + 1} 태그`,
    ),
  ),
  meta("safe", 1_000_000, "안전한 콘텐츠 등급"),
  meta("sensitive", 900_000, "민감한 콘텐츠 등급"),
  meta("nsfw", 800_000, "성인 콘텐츠 등급"),
  meta("explicit", 700_000, "노골적인 성인 콘텐츠 등급"),
  meta("newest", 2_000_000, "최신 시기의 작품 스타일"),
  meta("recent", 1_500_000, "비교적 최근 시기의 작품 스타일"),
  meta("mid", 1_000_000, "중간 시기의 작품 스타일"),
  meta("early", 800_000, "초기 시기의 작품 스타일"),
];

export const OFFLINE_TAGS: readonly OfflineTag[] = [
  general("1girl", 9_000_000, "One female character"),
  general("solo", 8_000_000, "A single main character"),
  general("looking at viewer", 5_500_000),
  general("full body", 1_500_000),
  general("upper body", 1_400_000),
  general("cowboy shot", 800_000),
  general("portrait", 650_000),
  general("standing", 1_900_000),
  general("sitting", 1_600_000),
  general("kneeling", 400_000),
  general("walking", 370_000),
  general("running", 290_000),
  general("waving", 330_000),
  general("head tilt", 420_000),
  general("arms at sides", 160_000),
  general("hands clasped", 120_000),
  general("holding", 1_400_000),
  general("holding cup", 130_000),
  general("holding plush", 55_000),
  general("closed mouth", 2_000_000),
  general("open mouth", 2_400_000),
  general("smile", 3_100_000),
  general("gentle smile", 180_000),
  general("shy", 240_000),
  general("blush", 3_300_000),
  general("sparkling eyes", 180_000),
  general("tareme", 130_000),
  general("fang", 850_000),
  general(":3", 220_000),
  general("long hair", 3_900_000),
  general("short hair", 3_300_000),
  general("black hair", 2_700_000),
  general("white hair", 2_300_000),
  general("pink hair", 1_400_000),
  general("blonde hair", 2_200_000),
  general("bangs", 4_500_000),
  general("straight bangs", 670_000),
  general("ahoge", 1_100_000),
  general("twintails", 1_100_000),
  general("red eyes", 2_000_000),
  general("pink eyes", 1_100_000),
  general("blue eyes", 3_000_000),
  general("white pupils", 110_000),
  general("animal ears", 1_600_000),
  general("cat ears", 950_000),
  general("dog ears", 270_000),
  general("fox ears", 240_000),
  general("animal ear fluff", 560_000),
  general("pink inner ears", 120_000),
  general("cat tail", 470_000),
  general("black cat tail", 75_000),
  general("hair ornament", 2_000_000),
  general("hair bow", 820_000),
  general("fishbone hair ornament", 9_000),
  general("sailor collar", 1_100_000),
  general("pink sailor collar", 85_000),
  general("sailor dress", 260_000),
  general("oversized clothes", 480_000),
  general("coat", 1_100_000),
  general("black coat", 280_000),
  general("bow", 2_000_000),
  general("pink bow", 390_000),
  general("large bow", 280_000),
  general("pom pom clothes ornament", 70_000),
  general("buttons", 550_000),
  general("pockets", 370_000),
  general("pleated skirt", 1_000_000),
  general("black skirt", 1_200_000),
  general("pink trim", 80_000),
  general("simple background", 2_500_000),
  general("white background", 1_800_000),
  general("pink background", 500_000),
  general("pastel background", 120_000),
  general("outdoors", 1_600_000),
  general("indoors", 1_300_000),
  general("bedroom", 650_000),
  general("classroom", 650_000),
  general("night", 1_500_000),
  general("day", 1_400_000),
  general("soft lighting", 480_000),
  general("backlighting", 720_000),
  general("flat color", 320_000),
  general("no lineart", 45_000),
  general("sketch", 1_000_000),
  general("pastel colors", 210_000),
  general("monochrome", 850_000),
  general("chibi", 650_000),
  meta("newest", 2_000_000),
  meta("masterpiece", 4_000_000),
  meta("best quality", 3_500_000),
  meta("very aesthetic", 1_400_000),
  meta("score_7", 1_000_000),
  meta("worst quality", 2_000_000),
  meta("low quality", 2_300_000),
  meta("blurry", 1_200_000),
  meta("jpeg artifacts", 480_000),
  meta("signature", 1_500_000),
  meta("watermark", 1_000_000),
  meta("3d", 900_000),
  meta("koikatsu (medium)", 90_000),
  meta("vrcg", 25_000),
];
