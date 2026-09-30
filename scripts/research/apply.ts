import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { expandRef, parseRef } from "../../src/scripture";
import { BOOKS, RESTORATION } from "../books";
import type { JudgeOutput } from "./schemas";
import type { Verifier } from "./verify";

/**
 * Applies judge ops to the YAML files as small text edits (append or replace one list item), so existing
 * formatting, comments, and flow style stay untouched and PR diffs show only real changes.
 */

type Span = { start: number; end: number };

/** Text span of a top-level `key:` block (to the next top-level key or EOF), or undefined. */
function topBlock(s: string, key: string): Span | undefined {
  const m = new RegExp(`^${key}:[^\\n]*\\n`, "m").exec(s);
  if (!m) return;
  const start = m.index;
  const body = start + m[0].length;
  const next = /^[A-Za-z_][\w-]*:/m.exec(s.slice(body));
  let end = next ? body + next.index : s.length;
  // Trailing blank and comment lines belong to the next block (e.g. a comment introducing it).
  for (;;) {
    const prev = s.lastIndexOf("\n", end - 2) + 1;
    if (prev <= body || !/^\s*(#.*)?\n?$/.test(s.slice(prev, end))) break;
    end = prev;
  }
  return { start, end };
}

/** Item spans (`<indent>- `) directly inside a span. */
function items(s: string, within: Span, indent: number): Span[] {
  const re = new RegExp(`^ {${indent}}- `, "gm");
  const starts: number[] = [];
  re.lastIndex = within.start;
  for (let m; (m = re.exec(s)) && m.index < within.end; ) starts.push(m.index);
  const next = new RegExp(`^ {0,${indent}}\\S`, "gm");
  return starts.map((st, i) => {
    let end = starts[i + 1] ?? within.end;
    // Stop an item before any line at an equal or lower indent that is not part of it (e.g. a sibling key).
    next.lastIndex = s.indexOf("\n", st) + 1;
    const m = next.exec(s);
    if (m && m.index < end && !s.startsWith(" ".repeat(indent) + "- ", m.index)) end = m.index;
    // Trailing blank lines separate items; keep them outside the item.
    while (end > st && s[end - 1] === "\n" && s[end - 2] === "\n") end--;
    return { start: st, end };
  });
}

/** Inserts an attribute into a node item as text, without re-rendering the node. */
function insertAttribute(s: string, node: Span, attr: unknown): string {
  const body = s.slice(node.start, node.end);
  const m = /^ {4}attributes:\s*\n/m.exec(body);
  if (!m) return s.slice(0, node.end) + `    attributes:\n${render(attr, 6)}` + s.slice(node.end);
  // End of the attributes block: the next line indented 4 or less after it.
  const after = node.start + m.index + m[0].length;
  const next = /^ {0,4}\S/m.exec(s.slice(after, node.end));
  const at = next ? after + next.index : node.end;
  return s.slice(0, at) + render(attr, 6) + s.slice(at);
}

function replaceAttribute(s: string, node: Span, attr: Record<string, unknown>): string | undefined {
  const match = /^ {4}attributes:\s*\n/m.exec(s.slice(node.start, node.end));
  if (!match) return;
  const start = node.start + match.index + match[0].length;
  const next = /^ {0,4}\S/m.exec(s.slice(start, node.end));
  const end = next ? start + next.index : node.end;
  const sp = items(s, { start, end }, 6).find((x) => itemValue(s, x, 6)?.name === attr.name);
  return sp ? s.slice(0, sp.start) + render(attr, 6) + s.slice(sp.end) : undefined;
}

const itemValue = (s: string, sp: Span, indent: number) => {
  const text = s
    .slice(sp.start, sp.end)
    .split("\n")
    .map((l) => l.slice(indent))
    .join("\n");
  try {
    return (parse(text) as unknown[])?.[0] as Record<string, unknown> | undefined;
  } catch {
    // An item parsed on its own can reference a YAML anchor defined elsewhere in the file (e.g. *godhead-cite).
    // Reads only need ids and names, so treat such aliases as null.
    return (parse(text.replace(/(:\s*|-\s+)\*[\w-]+/g, "$1null")) as unknown[])?.[0] as Record<string, unknown> | undefined;
  }
};

const render = (obj: unknown, indent: number) =>
  stringify([obj], { lineWidth: 0 })
    .trimEnd()
    .split("\n")
    .map((l) => " ".repeat(indent) + l)
    .join("\n") + "\n";

function appendItem(s: string, key: string, obj: unknown): string {
  const b = topBlock(s, key);
  if (!b) return `${s.trimEnd()}\n\n${key}:\n${render(obj, 2)}`;
  const sep = s[b.end - 1] === "\n" ? "" : "\n";
  return s.slice(0, b.end) + sep + render(obj, 2) + s.slice(b.end);
}

function replaceItem(s: string, key: string, match: (v: Record<string, unknown>) => boolean, obj: unknown): string | undefined {
  const b = topBlock(s, key);
  if (!b) return;
  const sp = items(s, b, 2).find((x) => {
    const v = itemValue(s, x, 2);
    return v && match(v);
  });
  if (!sp) return;
  return s.slice(0, sp.start) + render(obj, 2) + s.slice(sp.end);
}

function findItem(s: string, key: string, id: string) {
  const b = topBlock(s, key);
  return b ? items(s, b, 2).find((x) => itemValue(s, x, 2)?.id === id) : undefined;
}

// Book names the agents may write ("1 Kings", "Psalm", "Song of Solomon") → the data's abbreviations ("1 Kgs", "Ps").
const BOOK_ALIASES = new Map<string, string>([
  ...BOOKS.flatMap((b) => [b.abbr, b.name, b.name.replace(/ /g, "")].map((k) => [k.toLowerCase(), b.abbr] as [string, string])),
  ...Object.keys(RESTORATION).map((k) => [k.toLowerCase(), k] as [string, string]),
  ["psalm", "Ps"], ["song of solomon", "Song"], ["1 ki", "1 Kgs"], ["2 ki", "2 Kgs"], ["1 kings", "1 Kgs"], ["2 kings", "2 Kgs"],
  ["qur'an", "Quran"], ["quran", "Quran"], ["koran", "Quran"], ["1 nephi", "1 Ne"], ["2 nephi", "2 Ne"], ["3 nephi", "3 Ne"],
  ["doctrine and covenants", "D&C"], ["abraham", "Abr"], ["articles of faith", "A of F"],
]);
export const normalizeRef = (ref: string) => {
  const m = /^(.+?)\s+(\d+(?::[\d,\s-]+)?)$/.exec(ref.trim());
  const book = m && BOOK_ALIASES.get(m[1].toLowerCase().replace(/\.$/, ""));
  return m && book ? `${book} ${m[2].replace(/\s+/g, "")}` : ref;
};
/**
 * Removes verses a translation doesn't contain (e.g. ESV omits Matt 12:47) from a reference, splitting a range
 * around them: "Matt 12:46-50" without 12:47 becomes ["Matt 12:46", "Matt 12:48-50"].
 */
function withoutVerses(ref: string, drop: Set<string>): string[] {
  const p = parseRef(ref);
  if (!p) return drop.has(ref) ? [] : [ref];
  const keep = expandRef(ref).map((k) => +k.split(":")[1]).filter((v) => !drop.has(`${p.book} ${p.chapter}:${v}`));
  const out: string[] = [];
  for (let i = 0; i < keep.length; ) {
    let j = i;
    while (j + 1 < keep.length && keep[j + 1] === keep[j] + 1) j++;
    out.push(`${p.book} ${p.chapter}:${keep[i]}${j > i ? `-${keep[j]}` : ""}`);
    i = j + 1;
  }
  return out;
}

function normalizeScripture(v: unknown, drop = new Set<string>()): void {
  if (Array.isArray(v)) return v.forEach((x) => normalizeScripture(x, drop));
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  // The schema requires `bible`; a citation with only other scripture says so explicitly.
  const sc = o.scripture as Record<string, unknown> | undefined;
  if (sc && typeof sc === "object" && !Array.isArray(sc) && (sc.bible == null || (Array.isArray(sc.bible) && !sc.bible.length)))
    o.scripture = { bible: "none-cited", ...(sc.other ? { other: sc.other } : {}) };
  for (const key of ["bible", "other", "together"])
    if (Array.isArray(o[key]))
      o[key] = (o[key] as unknown[]).flatMap((x) => {
        if (typeof x === "string") return withoutVerses(normalizeRef(x), drop);
        if (x && typeof x === "object" && typeof (x as { ref?: unknown }).ref === "string") {
          const parts = withoutVerses(normalizeRef((x as { ref: string }).ref), drop);
          if (parts.length === 1) return [{ ...x, ref: parts[0] }];
          return parts; // a highlight can't survive a split range
        }
        return [x];
      });
  if (Array.isArray(o.bible) && !o.bible.length) o.bible = "none-cited";
  Object.values(o).forEach((x) => normalizeScripture(x, drop));
}

export interface ApplyReport {
  applied: string[];
  skipped: { op: string; reason: string }[];
  strippedQuotes: { url: string; quote: string }[];
}

export async function applyOps(
  root: string,
  tid: string,
  ops: JudgeOutput["ops"],
  _verified: { url: string; quote: string }[],
  verifier: Verifier,
  domains: string[],
  /** Verse keys the tradition's translation doesn't contain; they are removed from cited references. */
  dropVerses = new Set<string>(),
): Promise<ApplyReport> {
  const files = {
    meta: join(root, `data/traditions/${tid}/metamodel.yaml`),
    model: join(root, `data/traditions/${tid}/model.yaml`),
    referents: join(root, "data/referents.yaml"),
    topics: join(root, "data/topics.yaml"),
  };
  const text: Record<keyof typeof files, string> = {
    meta: readFileSync(files.meta, "utf8"),
    model: readFileSync(files.model, "utf8"),
    referents: readFileSync(files.referents, "utf8"),
    topics: readFileSync(files.topics, "utf8"),
  };
  const report: ApplyReport = { applied: [], skipped: [], strippedQuotes: [] };

  // Every authority quote written into the data must be one the pipeline verified (or verifiable now).
  const quoteOk = async (url: string, quote: string) => (await verifier.check({ url, quote }, domains)).status === "verified";
  const scrubQuotes = async (v: unknown): Promise<void> => {
    if (Array.isArray(v)) for (const x of v) await scrubQuotes(x);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.quote === "string" && typeof o.url === "string" && !(await quoteOk(o.url, o.quote))) {
        report.strippedQuotes.push({ url: o.url, quote: o.quote });
        delete o.quote;
      }
      for (const x of Object.values(o)) await scrubQuotes(x);
    }
  };

  for (const op of ops) {
    const label = `${op.op}${op.target ? `(${op.target})` : ""}`;
    let obj: Record<string, unknown>;
    try {
      obj = parse(op.yaml.replace(/^- /, "")) as Record<string, unknown>;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not a mapping");
    } catch (e) {
      report.skipped.push({ op: label, reason: `unparseable yaml: ${(e as Error).message}` });
      continue;
    }
    await scrubQuotes(obj);
    normalizeScripture(obj, dropVerses);
    const id = obj.id as string | undefined;
    const put = (file: keyof typeof files, next: string | undefined, why: string) => {
      if (next === undefined) return report.skipped.push({ op: label, reason: why });
      text[file] = next;
      report.applied.push(`${label} ${id ?? obj.debate ?? ""}`.trim());
    };
    switch (op.op) {
      case "add_node":
        put("model", findItem(text.model, "nodes", id!) ? undefined : appendItem(text.model, "nodes", obj), `node ${id} exists (use replace_node)`);
        break;
      case "replace_node":
        put("model", replaceItem(text.model, "nodes", (v) => v.id === id, obj), `node ${id} not found`);
        break;
      case "add_edge":
        put("model", findItem(text.model, "edges", id!) ? undefined : appendItem(text.model, "edges", obj), `edge ${id} exists (use replace_edge)`);
        break;
      case "replace_edge":
        put("model", replaceItem(text.model, "edges", (v) => v.id === id, obj), `edge ${id} not found`);
        break;
      case "replace_attribute": {
        const sp = op.target ? findItem(text.model, "nodes", op.target) : undefined;
        put("model", sp ? replaceAttribute(text.model, sp, obj) : undefined, `attribute "${obj.name}" on node ${op.target} not found`);
        break;
      }
      case "add_attribute": {
        const sp = op.target ? findItem(text.model, "nodes", op.target) : undefined;
        if (!sp) {
          put("model", undefined, `node ${op.target} not found`);
          break;
        }
        const exists = (itemValue(text.model, sp, 2)?.attributes as { name: string }[] | undefined)?.some((a) => a.name === obj.name);
        put("model", exists ? undefined : insertAttribute(text.model, sp, obj), `attribute "${obj.name}" exists on ${op.target}`);
        break;
      }
      case "replace_category":
        put("meta", replaceItem(text.meta, "categories", (v) => v.id === id, obj), `category ${id} not found`);
        break;
      case "add_category":
        put("meta", findItem(text.meta, "categories", id!) ? undefined : appendItem(text.meta, "categories", obj), `category ${id} exists`);
        break;
      case "add_relationship":
        put("meta", findItem(text.meta, "relationships", id!) ? undefined : appendItem(text.meta, "relationships", obj), `relationship ${id} exists`);
        break;
      case "add_axiom":
        put("meta", findItem(text.meta, "axioms", id!) ? undefined : appendItem(text.meta, "axioms", obj), `axiom ${id} exists`);
        break;
      case "add_outline_topic":
        put("meta", findItem(text.meta, "topics", id!) ? undefined : appendItem(text.meta, "topics", obj), `topic ${id} exists`);
        break;
      case "set_stance": {
        const debate = (obj.debate as string) ?? op.target;
        const stance = { debate, ...obj };
        put("meta", replaceItem(text.meta, "stances", (v) => v.debate === debate, stance) ?? appendItem(text.meta, "stances", stance), "");
        break;
      }
      case "add_referent": {
        const existing = findItem(text.referents, "referents", id!);
        if (!existing) {
          put("referents", appendItem(text.referents, "referents", obj), "");
          break;
        }
        const cur = itemValue(text.referents, existing, 2)!;
        cur.aliases = { ...(cur.aliases as object), ...(obj.aliases as object) };
        put("referents", text.referents.slice(0, existing.start) + render(cur, 2) + text.referents.slice(existing.end), "");
        break;
      }
      case "add_registry_topic":
        put("topics", findItem(text.topics, "topics", id!) ? undefined : appendItem(text.topics, "topics", obj), `registry topic ${id} exists`);
        break;
    }
  }
  for (const k of Object.keys(files) as (keyof typeof files)[]) writeFileSync(files[k], text[k]);
  return report;
}
