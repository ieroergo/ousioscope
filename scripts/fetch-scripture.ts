/**
 * Fetches the exact text of every cited verse from each tradition's preferred publisher and writes
 * data/scripture/<store>.yaml. Re-run after adding citations:  npm run fetch:scripture
 *
 * - nabre: New American Bible, Revised Edition, from bible.usccb.org (needs headless Chrome; the site
 *   blocks plain HTTP clients).
 * - lds:   KJV Bible + Restoration scripture as published at churchofjesuschrist.org.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { chapterOf, expandRef, flattenPassages } from "../src/scripture";
import { BOOKS, RESTORATION } from "./books";

const root = join(import.meta.dirname, "..");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ---------- collect cited verses per store ----------
function collectScripture(node: unknown, out: { bible: string[]; other: string[] }) {
  if (Array.isArray(node)) node.forEach((n) => collectScripture(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.scripture && typeof o.scripture === "object") {
      const s = o.scripture as { bible?: never; other?: never };
      out.bible.push(...flattenPassages(s.bible).flatMap((p) => expandRef(p.ref)));
      out.other.push(...flattenPassages(s.other).flatMap((p) => expandRef(p.ref)));
    }
    Object.values(o).forEach((v) => collectScripture(v, out));
  }
}

const wanted = new Map<string, Set<string>>();
for (const tid of readdirSync(join(root, "data/traditions"))) {
  const meta = parse(readFileSync(join(root, `data/traditions/${tid}/metamodel.yaml`), "utf8"));
  const model = parse(readFileSync(join(root, `data/traditions/${tid}/model.yaml`), "utf8"));
  const refs = { bible: [] as string[], other: [] as string[] };
  collectScripture([meta, model], refs);
  const { bible, other } = meta.tradition.scripture;
  for (const [store, list] of [
    [bible, refs.bible],
    [other, refs.other],
  ] as const) {
    if (!wanted.has(store)) wanted.set(store, new Set());
    list.forEach((v) => wanted.get(store)!.add(v));
  }
}

// ---------- HTML helpers ----------
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&ldquo;/g, "\u201c");
const clean = (html: string) =>
  decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?\u2019\u201d)])/g, "$1")
    .replace(/([\u2018\u201c(])\s+/g, "$1")
    .replace(/\bL ORD\b/g, "LORD") // small-caps markup splits LORD
    .replace(/¶\s*/g, "") // KJV paragraph marks
    .trim();

// ---------- NABRE (USCCB) ----------
const USCCB_BOOK: Record<string, string> = Object.fromEntries(BOOKS.map((b) => [b.abbr, b.usccb]));

/**
 * bible.usccb.org serves a JavaScript "checking connection" page first, then reloads. Drive the local
 * Chrome with puppeteer-core and wait for the scripture container to appear.
 */
let browser: Browser | undefined;
async function renderedHtml(url: string, selector: string): Promise<string> {
  browser ??= await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: "/tmp/onto-usccb-profile" });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(selector, { timeout: 30000 });
    return await page.content();
  } finally {
    await page.close();
  }
}

async function usccbChapter(chapter: string): Promise<{ url: string; verses: Record<number, string> }> {
  const [, book, ch] = chapter.match(/^(.+) (\d+)$/)!;
  const slug = USCCB_BOOK[book];
  if (!slug) throw new Error(`No USCCB slug for ${book}`);
  const url = `https://bible.usccb.org/bible/${slug}/${ch}`;
  await new Promise((r) => setTimeout(r, 1000));
  const stdout = await renderedHtml(url, "#scribeI");
  const start = stdout.indexOf('id="scribeI"');
  if (start < 0) throw new Error(`USCCB: no content for ${url}`);
  let body = stdout.slice(start);
  // Footnotes (<p class="fn ...">) and cross-references (<p class="en ...">) follow the text.
  const fnStart = body.search(/<p class="(?:fn|en)[ "]/);
  if (fnStart > 0) body = body.slice(0, fnStart);
  body = body
    .replace(/<a class="(?:fnref|enref)"[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<h\d[^>]*>[\s\S]*?<\/h\d>/g, "") // book/section headings
    .replace(/<b>[\s\S]*?<\/b>/g, ""); // pericope titles
  const verses: Record<number, string> = {};
  const parts = body.split(/<span class="bcv">(\d+)<\/span>/);
  for (let i = 1; i < parts.length; i += 2) verses[+parts[i]] = clean(parts[i + 1]);
  return { url, verses };
}

// ---------- churchofjesuschrist.org ----------
const LDS_BOOK: Record<string, string> = {
  ...Object.fromEntries(BOOKS.filter((b) => b.lds).map((b) => [b.abbr, b.lds!])),
  ...RESTORATION,
};

async function ldsChapter(chapter: string): Promise<{ url: string; verses: Record<number, string> }> {
  const [, book, ch] = chapter.match(/^(.+) (\d+)$/)!;
  const path = LDS_BOOK[book];
  if (!path) throw new Error(`No churchofjesuschrist.org path for ${book}`);
  const url = `https://www.churchofjesuschrist.org/study/scriptures/${path}/${ch}?lang=eng`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 onto-ontology-tool" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const html = await res.text();
  const verses: Record<number, string> = {};
  for (const m of html.matchAll(/<p class="verse"[^>]*id="p(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const inner = m[2]
      .replace(/<span class="iconPointer[\s\S]*?<\/span>/g, "")
      .replace(/<span class="verse-number">[\s\S]*?<\/span>/, "")
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, "");
    verses[+m[1]] = clean(inner);
  }
  return { url, verses };
}

// ---------- New World Translation (wol.jw.org) ----------
async function nwtChapter(chapter: string): Promise<ChapterResult> {
  const [, book, ch] = chapter.match(/^(.+) (\d+)$/)!;
  const no = BOOKS.find((b) => b.abbr === book)?.wol;
  if (!no) throw new Error(`No wol.jw.org book number for ${book}`);
  const url = `https://wol.jw.org/en/wol/b/r1/lp-e/nwtsty/${no}/${ch}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 onto-ontology-tool" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let html = await res.text();
  const end = html.indexOf('<div class="groupFootnote"');
  if (end > 0) html = html.slice(0, end);
  html = html.replace(/<h\d[^>]*>[^]*?<\/h\d>/g, "");
  return { url, verses: splitVerses(html, `<span id="v${no}-${ch}-`, (chunk) =>
    chunk
      .replace(/<a [^>]*class="(?:b|fn)"[^>]*>[^<]*<\/a>/g, "") // cross-reference "+" / footnote "*" markers
      .replace(/<a [^>]*class="[^"]*\bv[lx]\b[^"]*"[^>]*>[^]*?<\/a>/, "") // verse-number link
      .replace(/<strong>\d+<\/strong>/, ""),
  ) };
}

/**
 * Linear verse extraction: split the page at each verse-start marker (`${marker}<verse>-...`), then clean each
 * chunk up to the next marker. Avoids backtracking regexes on large pages.
 */
function splitVerses(html: string, marker: string, strip: (chunk: string) => string): Record<number, string> {
  const parts: Record<number, string[]> = {};
  const pieces = html.split(marker);
  for (const piece of pieces.slice(1)) {
    const v = parseInt(piece, 10);
    if (!v) continue;
    const body = piece.slice(piece.indexOf(">") + 1);
    const text = clean(strip(body));
    if (text) (parts[v] ??= []).push(text);
  }
  return Object.fromEntries(Object.entries(parts).map(([v, p]) => [v, p.join(" ")]));
}

// ---------- ESV (Crossway) via Bible Gateway ----------
async function esvChapter(chapter: string): Promise<ChapterResult> {
  const [, book, ch] = chapter.match(/^(.+) (\d+)$/)!;
  const name = BOOKS.find((b) => b.abbr === book)?.esv;
  if (!name) throw new Error(`No ESV book name for ${book}`);
  const url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(`${name} ${ch}`)}&version=ESV`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 onto-ontology-tool" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let html = await res.text();
  const start = html.search(/class=["']passage-content/);
  if (start < 0) throw new Error(`ESV: no passage content at ${url}`);
  const stop = html.search(/class=["']footnotes/);
  html = html.slice(start, stop > 0 ? stop : start + 400_000);
  html = html
    .replace(/<h\d[^>]*>[^]*?<\/h\d>/g, "") // section headings
    .replace(/<sup [^>]*class=['"](?:crossreference|footnote)['"][^>]*>[^]*?<\/sup>/g, "")
    .replace(/<sup class="versenum">[^<]*<\/sup>/g, "")
    .replace(/<span class="chapternum">[^<]*<\/span>/g, "")
    // Each verse span looks like <span id="en-ESV-26048" class="text John-1-14">; re-key the marker by chapter-verse.
    .replace(/<span (?:id="en-ESV-\d+" )?class="text [A-Za-z0-9]+-(\d+)-(\d+)">/g, (_, c, v) => (+c === +ch ? `§V§${v}">` : ""));
  const verses = splitVerses(html, "§V§", (chunk) => chunk);
  if (!Object.keys(verses).length) throw new Error(`ESV: no verses parsed at ${url}`);
  return { url: `https://www.esv.org/${encodeURIComponent(`${name} ${ch}`).replace(/%20/g, "+")}/`, verses };
}

// ---------- Qur'an (Tanzil) ----------
const tanzil = new Map<string, Promise<Map<string, string>>>();
function tanzilText(url: string) {
  if (!tanzil.has(url))
    tanzil.set(
      url,
      fetch(url, { headers: { "User-Agent": "Mozilla/5.0 onto-ontology-tool" }, signal: AbortSignal.timeout(60000) })
        .then((r) => r.text())
        .then((t) => new Map(t.split("\n").filter((l) => /^\d+\|\d+\|/.test(l)).map((l) => {
          const [s, a, ...rest] = l.split("|");
          return [`${s}:${a}`, rest.join("|").trim()] as [string, string];
        }))),
    );
  return tanzil.get(url)!;
}
const ARABIC = "https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true";
const quranChapter = (transId: string) => async (chapter: string): Promise<ChapterResult> => {
  const [, book, sura] = chapter.match(/^(.+) (\d+)$/)!;
  if (book !== "Quran") throw new Error(`Qur'an store cannot fetch ${chapter}`);
  const [en, ar] = await Promise.all([tanzilText(`https://tanzil.net/trans/?transID=${transId}&type=txt-2`), tanzilText(ARABIC)]);
  const verses: Record<number, string> = {};
  const originals: Record<number, string> = {};
  for (const [key, text] of en) if (key.startsWith(`${sura}:`)) verses[+key.split(":")[1]] = text;
  for (const [key, text] of ar) if (key.startsWith(`${sura}:`)) originals[+key.split(":")[1]] = text;
  return { url: `https://tanzil.net/#trans/${transId}/${sura}:1`, verses, originals };
};

interface ChapterResult {
  url: string;
  verses: Record<number, string>;
  originals?: Record<number, string>;
}

// ---------- stores ----------
const STORES: Record<string, { meta: Record<string, string>; fetchChapter: (ch: string) => Promise<ChapterResult>; concurrency: number }> = {
  nwt: {
    meta: {
      id: "nwt",
      name: "New World Translation of the Holy Scriptures (2013 revision)",
      abbreviation: "NWT",
      publisher: "Watch Tower Bible and Tract Society of Pennsylvania (wol.jw.org)",
      copyright: "New World Translation © Watch Tower Bible and Tract Society of Pennsylvania. Quoted for reference.",
    },
    fetchChapter: nwtChapter,
    concurrency: 3,
  },
  esv: {
    meta: {
      id: "esv",
      name: "English Standard Version",
      abbreviation: "ESV",
      publisher: "Crossway (retrieved via Bible Gateway; links point to esv.org)",
      copyright:
        "Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.",
    },
    fetchChapter: esvChapter,
    concurrency: 2,
  },
  kjv: {
    meta: {
      id: "kjv",
      name: "King James Version",
      abbreviation: "KJV",
      publisher: "Public domain text (retrieved from churchofjesuschrist.org)",
      copyright: "King James Version text is public domain.",
    },
    fetchChapter: ldsChapter,
    concurrency: 4,
  },
  "quran-sahih": {
    meta: {
      id: "quran-sahih",
      name: "The Qur'an, Saheeh International translation, with Uthmani Arabic",
      abbreviation: "Saheeh Intl.",
      publisher: "Saheeh International; text via Tanzil (tanzil.net)",
      copyright: "Translation © Saheeh International. Arabic Uthmani text © Tanzil Project (CC BY 3.0), verbatim.",
      originalLang: "ar",
    },
    fetchChapter: quranChapter("en.sahih"),
    concurrency: 1,
  },
  "quran-qarai": {
    meta: {
      id: "quran-qarai",
      name: "The Qur'an, translated by Ali Quli Qara'i, with Uthmani Arabic",
      abbreviation: "Qara'i",
      publisher: "Ali Quli Qara'i (ICAS Press); text via Tanzil (tanzil.net)",
      copyright: "Translation © Ali Quli Qara'i. Arabic Uthmani text © Tanzil Project (CC BY 3.0), verbatim.",
      originalLang: "ar",
    },
    fetchChapter: quranChapter("en.qarai"),
    concurrency: 1,
  },
  nabre: {
    meta: {
      id: "nabre",
      name: "New American Bible, Revised Edition",
      abbreviation: "NABRE",
      publisher: "United States Conference of Catholic Bishops (bible.usccb.org)",
      copyright:
        "Scripture texts in this work are taken from the New American Bible, revised edition © 2010, 1991, 1986, 1970 Confraternity of Christian Doctrine, Washington, D.C. and are used by permission of the copyright owner. All Rights Reserved.",
    },
    fetchChapter: usccbChapter,
    concurrency: 1,
  },
  lds: {
    meta: {
      id: "lds",
      name: "King James Version and Restoration scripture (Latter-day Saint edition)",
      abbreviation: "KJV / LDS",
      publisher: "The Church of Jesus Christ of Latter-day Saints (churchofjesuschrist.org)",
      copyright:
        "King James Version text is public domain. Book of Mormon, Doctrine and Covenants, and Pearl of Great Price text © Intellectual Reserve, Inc., quoted for reference.",
    },
    fetchChapter: ldsChapter,
    concurrency: 4,
  },
};

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { for (let t; (t = queue.shift()); ) await fn(t); }));
}

for (const [storeId, verseSet] of wanted) {
  const cfg = STORES[storeId];
  if (!cfg) throw new Error(`Unknown scripture store "${storeId}"`);
  const file = join(root, `data/scripture/${storeId}.yaml`);
  const existing = existsSync(file) ? parse(readFileSync(file, "utf8")) : { chapters: {}, verses: {} };
  const verses: Record<string, string> = existing.verses ?? {};
  const chapters: Record<string, string> = existing.chapters ?? {};
  const originals: Record<string, string> = existing.originals ?? {};
  const missing = [...verseSet].filter((v) => !verses[v]);
  const todo = [...new Set(missing.map(chapterOf))];
  console.log(`${storeId}: ${verseSet.size} cited verses, ${missing.length} missing, fetching ${todo.length} chapters`);
  const failed: string[] = [];
  const sortKey = (k: string) => k.replace(/\d+/g, (d) => d.padStart(4, "0"));
  const sorted = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => (sortKey(a) < sortKey(b) ? -1 : 1)));
  const save = () =>
    writeFileSync(
      file,
      `# Generated by scripts/fetch-scripture.ts. Do not hand-edit verse text.\n` +
        stringify(
          {
            ...cfg.meta,
            chapters: sorted(chapters),
            verses: sorted(verses),
            ...(Object.keys(originals).length ? { originals: sorted(originals) } : {}),
          },
          { lineWidth: 0 },
        ),
    );
  await pool(todo, cfg.concurrency, async (ch) => {
    let result: Awaited<ReturnType<typeof cfg.fetchChapter>> | undefined;
    for (let attempt = 1; attempt <= 4 && !result; attempt++) {
      try {
        result = await cfg.fetchChapter(ch);
      } catch (e) {
        console.error(`  … ${ch} attempt ${attempt} failed: ${(e as Error).message.split("\n")[0]}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (!result) return void failed.push(ch);
    const { url, verses: got, originals: gotOrig } = result;
    chapters[ch] = url;
    for (const v of missing.filter((m) => chapterOf(m) === ch)) {
      const n = +v.split(":")[1];
      if (got[n]) verses[v] = got[n];
      else console.error(`  ! ${v}: verse not found at ${url}`);
      if (gotOrig?.[n]) originals[v] = gotOrig[n];
    }
    save();
    console.log(`  ✓ ${ch}`);
  });
  save();
  if (failed.length) {
    console.error(`${storeId}: failed chapters (re-run to retry): ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}
// browser.close() can stall with the system Chrome; kill it outright and exit explicitly.
browser?.process()?.kill("SIGKILL");
process.exit();
