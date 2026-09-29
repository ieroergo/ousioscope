import type { PassageItem, PassageRef } from "./schema";

export interface Passage {
  ref: string;
  highlight?: string;
}

export const toPassage = (p: PassageRef): Passage => (typeof p === "string" ? { ref: p } : p);
export const isGroup = (i: PassageItem): i is { together: PassageRef[]; note: string } =>
  typeof i === "object" && "together" in i;

/** All passages in a citation list, with groups flattened. */
export const flattenPassages = (items: PassageItem[] | "none-cited" | undefined): Passage[] =>
  Array.isArray(items) ? items.flatMap((i) => (isGroup(i) ? i.together.map(toPassage) : [toPassage(i)])) : [];

/** "1 Cor 15:35-50" -> { book: "1 Cor", chapter: 15, from: 35, to: 50 } */
export function parseRef(ref: string) {
  const m = ref.trim().replace(/\s+/g, " ").match(/^(.+?) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return undefined;
  return { book: m[1], chapter: +m[2], from: +m[3], to: +(m[4] ?? m[3]) };
}

/** Expands a reference into single-verse keys, e.g. "John 1:1-3" -> ["John 1:1", "John 1:2", "John 1:3"]. */
export function expandRef(ref: string): string[] {
  const p = parseRef(ref);
  if (!p) return [ref.trim()];
  const out: string[] = [];
  for (let v = p.from; v <= p.to; v++) out.push(`${p.book} ${p.chapter}:${v}`);
  return out;
}

export const chapterOf = (verseKey: string) => verseKey.replace(/:\d+$/, "");

const norm = (s: string) =>
  s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();

/** Case/quote/whitespace-insensitive search; returns [start, end) in `text` or undefined. */
export function findPhrase(text: string, phrase: string): [number, number] | undefined {
  const t = norm(text);
  const i = t.indexOf(norm(phrase));
  if (i < 0 || t.length !== text.length) {
    if (i < 0) return undefined;
    // Fallback when normalization changed length: locate by rebuilding offsets.
    let ti = 0;
    const map: number[] = [];
    for (let k = 0; k < text.length; k++) {
      const collapsed = /\s/.test(text[k]) && k > 0 && /\s/.test(text[k - 1]);
      if (!collapsed) map[ti++] = k;
    }
    return [map[i], map[i + norm(phrase).length - 1] + 1];
  }
  return [i, i + phrase.length];
}
