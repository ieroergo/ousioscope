/**
 * Builds data/scripture/original.yaml from data/scripture/original-curation.yaml:  npm run fetch:original
 *
 * Sources (all openly licensed or public domain):
 * - Greek NT: SBLGNT via MorphGNT (text CC BY 4.0 Society of Biblical Literature; morphology CC BY-SA)
 * - Hebrew OT: Westminster Leningrad Codex via Open Scriptures Hebrew Bible (CC BY 4.0)
 * - Textus Receptus: Scrivener 1894, M. A. Robinson edition (public domain), the Greek text behind the KJV NT
 * - Latin: Nova Vulgata, vatican.va (the Catholic Church's official Latin edition)
 * - Glosses: Dodson Greek Lexicon (public domain); Strong's Hebrew dictionary (public domain, Open Scriptures XML)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { parseRef } from "../src/scripture";

const root = join(import.meta.dirname, "..");
const curation = parse(readFileSync(join(root, "data/scripture/original-curation.yaml"), "utf8")).entries as {
  ref: string;
  lang: "grc" | "hbo";
  focus: string[];
  why: string;
  quotes?: string;
}[];

const cache = new Map<string, Promise<string>>();
const get = (url: string, encoding = "utf-8") => {
  if (!cache.has(url))
    cache.set(
      url,
      fetch(url, { signal: AbortSignal.timeout(30000) }).then(async (r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return new TextDecoder(encoding).decode(await r.arrayBuffer());
      }),
    );
  return cache.get(url)!;
};

const stripMarks = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f\u0591-\u05c7]/g, "").toLowerCase().replace(/ς/g, "σ");

// ---------- Greek ----------
const GNT_FILE: Record<string, string> = {
  Matt: "61-Mt", Luke: "63-Lk", John: "64-Jn", Phil: "71-Php", Col: "72-Col", Heb: "79-Heb",
};
const TR_FILE: Record<string, string> = { Matt: "MT", Luke: "LU", John: "JOH", Phil: "PHP", Col: "COL", Heb: "HEB" };
const NV_FILE: Record<string, string> = {
  Gen: "vt_genesis", Isa: "vt_isaiae", Matt: "nt_evang-matthaeum", Luke: "nt_evang-lucam", John: "nt_evang-ioannem",
  Phil: "nt_epist-philippenses", Col: "nt_epist-colossenses", Heb: "nt_epist-hebraeos",
};

const TRANSLIT: Record<string, string> = {
  α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "ē", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "ph", χ: "ch", ψ: "ps", ω: "ō",
};
function greekTranslit(word: string) {
  const d = word.normalize("NFD").toLowerCase();
  let out = "";
  const rough = d.includes("\u0314");
  for (const ch of d.replace(/[\u0300-\u036f]/g, "")) out += TRANSLIT[ch] ?? ch;
  out = out.replace(/g(?=[gkxch])/g, "n").replace(/(^|[^aeēioōy])y/g, "$1u").replace(/([aeēo])y/g, "$1u");
  return (rough ? "h" : "") + out.replace(/[^a-zēōh]/g, "");
}

const POS: Record<string, string> = {
  "A-": "adjective", C: "conjunction", D: "adverb", I: "interjection", N: "noun", P: "preposition",
  "RA": "article", RD: "demonstrative pronoun", RI: "interrogative/indefinite pronoun", RP: "personal pronoun",
  RR: "relative pronoun", V: "verb", X: "particle",
};
const PERSON: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };
const TENSE: Record<string, string> = { P: "present", I: "imperfect", F: "future", A: "aorist", X: "perfect", Y: "pluperfect" };
const VOICE: Record<string, string> = { A: "active", M: "middle", P: "passive" };
const MOOD: Record<string, string> = { I: "indicative", D: "imperative", S: "subjunctive", O: "optative", N: "infinitive", P: "participle" };
const CASE: Record<string, string> = { N: "nominative", G: "genitive", D: "dative", A: "accusative", V: "vocative" };
const NUMBER: Record<string, string> = { S: "singular", P: "plural" };
const GENDER: Record<string, string> = { M: "masculine", F: "feminine", N: "neuter" };
function greekParse(pos: string, code: string) {
  const [p, t, v, m, c, n, g] = code;
  const kind = POS[pos] ?? POS[pos[0]] ?? pos;
  return [kind, PERSON[p], TENSE[t], VOICE[v], MOOD[m], CASE[c], NUMBER[n], GENDER[g]].filter(Boolean).join(" ");
}

let dodson: Map<string, { strongs: string; gloss: string }> | undefined;
async function greekGloss(lemma: string) {
  if (!dodson) {
    const csv = await get("https://raw.githubusercontent.com/biblicalhumanities/Dodson-Greek-Lexicon/master/dodson.csv");
    const BETA: Record<string, string> = {
      a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι", k: "κ", l: "λ", m: "μ", n: "ν",
      c: "ξ", o: "ο", p: "π", r: "ρ", s: "σ", t: "τ", u: "υ", f: "φ", x: "χ", y: "ψ", w: "ω",
    };
    dodson = new Map();
    for (const line of csv.split("\n").slice(1)) {
      const cols = line.split("\t").map((c) => c.replace(/^"|"$/g, ""));
      if (cols.length < 4) continue;
      const word = cols[2].split(",")[0].toLowerCase();
      // Keep rough breathing in the key so e.g. εἷς (one) and εἰς (into) stay distinct.
      const key = (word.includes("(") ? "h" : "") + [...word].map((ch) => BETA[ch] ?? "").join("");
      if (key && !dodson.has(key)) dodson.set(key, { strongs: `G${+cols[0]}`, gloss: cols[3] });
    }
  }
  const key = (lemma.normalize("NFD").includes("\u0314") ? "h" : "") + stripMarks(lemma);
  return dodson.get(key) ?? { strongs: undefined, gloss: "" };
}

const TR_ASCII: Record<string, string> = {
  α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "h", θ: "y", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "v", τ: "t", υ: "u", φ: "f", χ: "c", ψ: "q", ω: "w",
};
const ASCII_TR = Object.fromEntries(Object.entries(TR_ASCII).map(([g, a]) => [a, g]));
const toTrAscii = (w: string) => [...w.normalize("NFD").toLowerCase().replace(/[\u0300-\u036f]/g, "")].map((c) => TR_ASCII[c] ?? "").join("");
const fromTrAscii = (w: string) => [...w].map((c) => ASCII_TR[c] ?? c).join("").replace(/σ$/, "ς");

async function textusReceptus(book: string, ch: number, v: number): Promise<string[]> {
  const raw = await get(`https://raw.githubusercontent.com/byztxt/greektext-scrivener/master/textonly/${TR_FILE[book]}.SCV`);
  const flat = raw.replace(/\r/g, "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ");
  const m = flat.match(new RegExp(`(?:^| )${ch}:${v} (.*?)(?= \\d+:\\d+ |$)`));
  if (!m) throw new Error(`TR: ${book} ${ch}:${v} not found`);
  return m[1].trim().split(" ").filter((w) => /^[a-z]+$/.test(w));
}

async function greekEntry(c: (typeof curation)[number]) {
  const r = parseRef(c.ref)!;
  const bookNo = GNT_FILE[r.book];
  const raw = await get(`https://raw.githubusercontent.com/morphgnt/sblgnt/master/${bookNo}-morphgnt.txt`);
  const bcv = `${String(Object.keys(GNT_FILE).indexOf(r.book) >= 0 ? NT_ORDER[r.book] : 0).padStart(2, "0")}${String(r.chapter).padStart(2, "0")}${String(r.from).padStart(2, "0")}`;
  const rows = raw.split("\n").filter((l) => l.startsWith(bcv + " ")).map((l) => l.split(" "));
  if (!rows.length) throw new Error(`MorphGNT: ${c.ref} not found`);
  const focus = new Set(c.focus.map(stripMarks));
  const words = [];
  for (const [, pos, code, text, word, , lemma] of rows) {
    const { strongs, gloss } = await greekGloss(lemma);
    words.push({
      form: word,
      translit: greekTranslit(word),
      lemma,
      ...(strongs ? { strongs } : {}),
      morph: `${pos} ${code}`,
      parse: greekParse(pos.trim(), code),
      gloss,
      ...(focus.has(stripMarks(lemma)) ? { focus: true } : {}),
      _text: text,
    });
  }
  const tr = await textusReceptus(r.book, r.chapter, r.from);
  const trAround = [
    ...(await textusReceptus(r.book, r.chapter, r.from - 1).catch(() => [])),
    ...(await textusReceptus(r.book, r.chapter, r.from + 1).catch(() => [])),
  ];
  const sbl = words.flatMap((w) => normalizeForms(toTrAscii(w.form)));
  const trN = tr.flatMap(normalizeForms);
  const identical = sbl.join(" ") === trN.join(" ");
  const diff = identical ? undefined : describeDiff(sbl, trN, trAround.flatMap(normalizeForms));
  const agrees = identical || /^verse division differs/.test(diff ?? "");
  return {
    ref: c.ref,
    lang: "grc" as const,
    source: "SBL Greek New Testament (MorphGNT morphology)",
    text: words.map((w) => w._text).join(" "),
    why: c.why.trim(),
    ...(c.quotes ? { quotes: c.quotes } : {}),
    words: words.map(({ _text, ...w }) => w),
    textusReceptus: {
      agrees,
      text: tr.map(fromTrAscii).join(" "),
      ...(diff ? { note: diff } : {}),
    },
  };
}
const NT_ORDER: Record<string, number> = { Matt: 1, Luke: 3, John: 4, Phil: 11, Col: 12, Heb: 19 };

/** Treat crasis and elision as the same words: κἀγώ = καὶ ἐγώ, ἀλλ' = ἀλλά, δι' = διά. */
const normalizeForms = (w: string) =>
  ({ kagw: ["kai", "egw"], all: ["alla"], di: ["dia"], ap: ["apo"], ep: ["epi"], kat: ["kata"], met: ["meta"] })[w] ?? [w];

function describeDiff(a: string[], b: string[], bNeighbors: string[]) {
  const onlyA = a.filter((w) => !b.includes(w));
  const moved = onlyA.filter((w) => bNeighbors.includes(w));
  const onlyB = b.filter((w) => !a.includes(w)).map(fromTrAscii);
  const parts = [];
  const variantA = onlyA.filter((w) => !moved.includes(w)).map(fromTrAscii);
  if (variantA.length) parts.push(`SBLGNT only: ${variantA.join(", ")}`);
  if (onlyB.length) parts.push(`TR only: ${onlyB.join(", ")}`);
  if (moved.length) parts.push(`verse division differs (TR places "${moved.map(fromTrAscii).join(" ")}" in an adjacent verse)`);
  return parts.length ? parts.join("; ") : "Same words, different order";
}

// ---------- Hebrew ----------
const OSHB_FILE: Record<string, string> = { Gen: "Gen", Isa: "Isa" };
let strongsHeb: string | undefined;
async function hebrewLexicon(num: string) {
  strongsHeb ??= await get("https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/HebrewStrong.xml");
  const m = strongsHeb.match(new RegExp(`<entry id="H${num}">([\\s\\S]*?)</entry>`));
  if (!m) return { xlit: "", gloss: "", lemma: "" };
  const w = m[1].match(/<w [^>]*xlit="([^"]*)"[^>]*>([^<]*)<\/w>/);
  const defs = [...m[1].matchAll(/<def>([^<]*)<\/def>/g)].map((d) => d[1]);
  const usage = m[1].match(/<usage>([\s\S]*?)<\/usage>/)?.[1].replace(/<[^>]+>/g, "").trim();
  return { xlit: w?.[1] ?? "", lemma: w?.[2] ?? "", gloss: defs.join("; ") || usage || "" };
}

const HEB_POS: Record<string, string> = {
  A: "adjective", C: "conjunction", D: "adverb", N: "noun", P: "pronoun", R: "preposition", S: "suffix",
  T: "particle", V: "verb",
};
const HEB_STEM: Record<string, string> = { q: "qal", N: "niphal", p: "piel", P: "pual", h: "hiphil", H: "hophal", t: "hithpael" };
const HEB_ASPECT: Record<string, string> = {
  p: "perfect", q: "sequential perfect", i: "imperfect", w: "sequential imperfect", h: "cohortative",
  j: "jussive", v: "imperative", r: "participle", s: "passive participle", a: "infinitive absolute", c: "infinitive construct",
};
const HEB_G: Record<string, string> = { m: "masculine", f: "feminine", b: "common", c: "common" };
const HEB_N: Record<string, string> = { s: "singular", p: "plural", d: "dual" };
const HEB_STATE: Record<string, string> = { a: "absolute", c: "construct", d: "determined" };
function hebrewParse(morph: string) {
  return morph
    .replace(/^H/, "")
    .split("/")
    .map((seg) => {
      const t = seg[0];
      if (t === "V") return ["verb", HEB_STEM[seg[1]], HEB_ASPECT[seg[2]], PERSON[seg[3]], HEB_G[seg[4]], HEB_N[seg[5]]].filter(Boolean).join(" ");
      if (t === "N") return ["noun", seg[1] === "p" ? "proper" : "", HEB_G[seg[2]], HEB_N[seg[3]], HEB_STATE[seg[4]]].filter(Boolean).join(" ");
      if (t === "T" && seg[1] === "d") return "article";
      if (t === "C") return "conjunction";
      if (t === "R") return "preposition";
      return HEB_POS[t] ?? seg;
    })
    .join(" + ");
}

async function hebrewEntry(c: (typeof curation)[number]) {
  const r = parseRef(c.ref)!;
  const xml = await get(`https://raw.githubusercontent.com/openscriptures/morphhb/master/wlc/${OSHB_FILE[r.book]}.xml`);
  const vm = xml.match(new RegExp(`<verse osisID="${r.book}\\.${r.chapter}\\.${r.from}">([\\s\\S]*?)</verse>`));
  if (!vm) throw new Error(`OSHB: ${c.ref} not found`);
  const words = [];
  const forms: string[] = [];
  for (const m of vm[1].matchAll(/<w lemma="([^"]*)"[^>]*morph="([^"]*)"[^>]*>([^<]*)<\/w>/g)) {
    const [, lemmaAttr, morph, form] = m;
    const num = lemmaAttr.split("/").pop()!.replace(/\D/g, "");
    const lex = await hebrewLexicon(num);
    const display = form.replace(/\//g, "");
    forms.push(display);
    words.push({
      form: display,
      translit: lex.xlit,
      lemma: lex.lemma,
      strongs: `H${num}`,
      morph,
      parse: hebrewParse(morph),
      gloss: lex.gloss,
      ...(c.focus.includes(num) ? { focus: true } : {}),
    });
  }
  return {
    ref: c.ref,
    lang: "hbo" as const,
    source: "Westminster Leningrad Codex (Open Scriptures Hebrew Bible morphology)",
    text: forms.join(" "),
    why: c.why.trim(),
    words,
  };
}

// ---------- Nova Vulgata ----------
async function novaVulgata(ref: string) {
  const r = parseRef(ref)!;
  const url = `https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_${NV_FILE[r.book]}_lt.html`;
  const html = await get(url, "windows-1252");
  const chunks = html.split(/<a name="(\d+)">/);
  const idx = chunks.findIndex((x, i) => i % 2 === 1 && +x === r.chapter);
  if (idx < 0) throw new Error(`Nova Vulgata: chapter ${ref} not found`);
  const text = chunks[idx + 1]
    .replace(/^\d+<\/a>/, "") // the chapter-number link text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const m = text.match(new RegExp(`(?:^|\\n)\\s*${r.from}\\s+([\\s\\S]*?)(?=\\n\\s*${r.from + 1}\\s|$)`));
  if (!m) throw new Error(`Nova Vulgata: ${ref} not found`);
  const verse = m[1].replace(/\s+/g, " ").trim().replace(new RegExp(`^${r.from}\\s+`), "");
  return { text: verse, url: `${url}#${r.chapter}` };
}

const entries = [];
for (const c of curation) {
  const entry = c.lang === "grc" ? await greekEntry(c) : await hebrewEntry(c);
  entries.push({ ...entry, novaVulgata: await novaVulgata(c.ref) });
  console.log(`✓ ${c.ref}`);
}
writeFileSync(
  join(root, "data/scripture/original.yaml"),
  `# Generated by scripts/fetch-original.ts from original-curation.yaml. Do not hand-edit.\n` +
    stringify(
      {
        attribution: [
          "Greek: SBL Greek New Testament © 2010 Society of Biblical Literature and Logos Bible Software (CC BY 4.0); morphology from MorphGNT (CC BY-SA).",
          "Hebrew: Westminster Leningrad Codex; morphology and lemmas from the Open Scriptures Hebrew Bible (CC BY 4.0).",
          "Textus Receptus: Scrivener 1894, ed. M. A. Robinson (public domain), shown unaccented.",
          "Latin: Nova Vulgata, Bibliorum Sacrorum Editio (vatican.va).",
          "Glosses: Dodson Greek Lexicon (public domain); Strong's Hebrew Dictionary (public domain).",
        ],
        entries,
      },
      { lineWidth: 0 },
    ),
);
