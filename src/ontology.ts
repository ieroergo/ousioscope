import { parse } from "yaml";
import { z } from "zod";
import { expandRef, findPhrase, flattenPassages } from "./scripture";
import {
  Metamodel,
  Model,
  OriginalFile,
  Referents,
  ScriptureStore,
  type PassageItem,
  type Axiom,
  type Category,
  type Citations,
  type Dataset,
  type Edge,
  type Quantifier,
  type Tradition,
} from "./schema";

export function categoryIndex(meta: Metamodel): Map<string, Category> {
  return new Map(meta.categories.map((c) => [c.id, c]));
}

export function categoryPath(meta: Metamodel, categoryId: string): Category[] {
  const index = categoryIndex(meta);
  const path: Category[] = [];
  const seen = new Set<string>();
  for (let c = index.get(categoryId); c && !seen.has(c.id); c = c.parent ? index.get(c.parent) : undefined) {
    seen.add(c.id);
    path.unshift(c);
  }
  return path;
}

export const isA = (meta: Metamodel, categoryId: string, ancestorId: string) =>
  categoryPath(meta, categoryId).some((c) => c.id === ancestorId);

const STOPWORDS = new Set(["of", "the", "a", "an", "and", "in", "to"]);
/** Words allowed after the leading verb of a relationship name (e.g. proceedsFrom, hasPart, isOneWith). */
const VERB_PARTICLES = new Set(["from", "with", "to", "in", "into", "of", "upon", "on", "by", "through", "part", "one", "like"]);
const rawWords = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
const words = (s: string) => rawWords(s).filter((w) => !STOPWORDS.has(w));

export { expandRef } from "./scripture";

/** A citable claim: an individual, one of its attributes, an instance-level edge, or a class-level axiom. */
export interface Claim {
  kind: "node" | "edge" | "axiom";
  id: string;
  via?: string;
  citations: Citations;
}

export function modelClaims({ meta, model }: Tradition): Claim[] {
  return [
    ...model.nodes.flatMap((n): Claim[] => [
      { kind: "node", id: n.id, citations: n.citations },
      ...(n.attributes ?? []).map((a): Claim => ({ kind: "node", id: n.id, via: a.name, citations: a.citations })),
    ]),
    ...model.edges.map((e): Claim => ({ kind: "edge", id: e.id, citations: e.citations })),
    ...meta.axioms.map((a): Claim => ({ kind: "axiom", id: a.id, citations: a.citations })),
  ];
}

const QUANTIFIER_TEXT: Record<Quantifier, string> = { some: "some", all: "every", kind: "the kind" };

/** Human-readable reference to a kind, e.g. "some «Human Nature»". */
export function kindPhrase(meta: Metamodel, categoryId: string, q: Quantifier = "some") {
  return `${QUANTIFIER_TEXT[q]} «${categoryIndex(meta).get(categoryId)?.label ?? categoryId}»`;
}

/** Parts of an edge for display: source label, verb (with "as to"), target label. */
export function describeEdge({ meta, model }: Tradition, e: Edge) {
  const cats = categoryIndex(meta);
  const node = (id: string) => model.nodes.find((n) => n.id === id)?.label ?? id;
  const verb = meta.relationships.find((r) => r.id === e.rel)?.label ?? e.rel;
  return {
    source: node(e.source),
    verb,
    asTo: e.asTo ? cats.get(e.asTo)?.label ?? e.asTo : undefined,
    target: e.target ? node(e.target) : kindPhrase(meta, e.targetKind!, e.quantifier),
  };
}

export function describeAxiom(meta: Metamodel, a: Axiom) {
  const cats = categoryIndex(meta);
  return {
    source: `every «${cats.get(a.source)?.label ?? a.source}»`,
    verb: meta.relationships.find((r) => r.id === a.rel)?.label ?? a.rel,
    target: kindPhrase(meta, a.target, a.quantifier),
  };
}

/** Map of single-verse key -> claims whose Bible citations include that verse. */
export function versesCited(t: Tradition): Map<string, Claim[]> {
  const out = new Map<string, Claim[]>();
  for (const claim of modelClaims(t)) {
    const keys = new Set(flattenPassages(claim.citations.scripture.bible).flatMap((p) => expandRef(p.ref)));
    for (const key of keys) out.set(key, [...(out.get(key) ?? []), claim]);
  }
  return out;
}

/** Index of the highest authority tier backing a claim (0 = highest). */
export const bestTier = (meta: Metamodel, c: Citations) =>
  Math.min(...c.authority.map((a) => meta.tradition.tiers.findIndex((t) => t.id === a.tier)));

export function allCitations(t: Tradition): { owner: string; citations: Citations }[] {
  const out: { owner: string; citations: Citations }[] = [];
  const { meta, model } = t;
  for (const c of meta.categories) out.push({ owner: `category ${c.id}`, citations: c.citations });
  for (const r of meta.relationships) out.push({ owner: `relationship ${r.id}`, citations: r.citations });
  for (const a of meta.axioms) out.push({ owner: `axiom ${a.id}`, citations: a.citations });
  for (const n of model.nodes) {
    out.push({ owner: `node ${n.id}`, citations: n.citations });
    for (const a of n.attributes ?? []) out.push({ owner: `node ${n.id} attribute "${a.name}"`, citations: a.citations });
  }
  for (const e of model.edges) out.push({ owner: `edge ${e.id}`, citations: e.citations });
  return out;
}

function zodErrors(file: string, err: z.ZodError) {
  return err.issues.map((i) => `${file}: ${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Parses raw YAML files keyed by repo-relative path (e.g. "data/traditions/lds/model.yaml"). */
export function loadDataset(files: Record<string, string>): { dataset?: Dataset; errors: string[] } {
  const errors: string[] = [];
  const read = <T>(path: string, schema: z.ZodType<T>): T | undefined => {
    const raw = files[path];
    if (raw === undefined) return void errors.push(`${path}: missing file`);
    let data: unknown;
    try {
      data = parse(raw);
    } catch (e) {
      return void errors.push(`${path}: YAML error: ${(e as Error).message}`);
    }
    const res = schema.safeParse(data);
    if (!res.success) return void errors.push(...zodErrors(path, res.error));
    return res.data;
  };

  const referents = read("data/referents.yaml", Referents)?.referents;
  const ids = [
    ...new Set(
      Object.keys(files)
        .map((p) => p.match(/^data\/traditions\/([^/]+)\//)?.[1])
        .filter((x): x is string => !!x),
    ),
  ].sort();
  const traditions: Tradition[] = [];
  for (const tid of ids) {
    const meta = read(`data/traditions/${tid}/metamodel.yaml`, Metamodel);
    const model = read(`data/traditions/${tid}/model.yaml`, Model);
    if (meta && model) traditions.push({ meta, model });
  }
  const stores: Record<string, ScriptureStore> = {};
  for (const path of Object.keys(files).filter((p) => /^data\/scripture\/(?!original)[^/]+\.yaml$/.test(p))) {
    const store = read(path, ScriptureStore);
    if (store) stores[store.id] = store;
  }
  const original = read("data/scripture/original.yaml", OriginalFile);
  if (errors.length || !referents || !original) return { errors };
  const dataset = { referents, traditions, stores, original };
  errors.push(...validateDataset(dataset));
  return { dataset, errors };
}

/** Text of a passage (all verses joined) from a store; undefined if any verse is missing. */
export function passageText(store: ScriptureStore | undefined, ref: string): string | undefined {
  if (!store) return;
  const verses = expandRef(ref).map((v) => store.verses[v]);
  return verses.every(Boolean) ? verses.join(" ") : undefined;
}

function validateScripture(
  items: PassageItem[] | "none-cited" | undefined,
  store: ScriptureStore | undefined,
  what: string,
  err: (m: string) => unknown,
) {
  for (const p of flattenPassages(items)) {
    const missing = expandRef(p.ref).filter((v) => !store?.verses[v]);
    if (missing.length) {
      err(`${what}: no ${store?.abbreviation ?? "scripture store"} text for ${missing.join(", ")} (run npm run fetch:scripture)`);
      continue;
    }
    if (p.highlight && !findPhrase(passageText(store, p.ref)!, p.highlight))
      err(`${what}: highlight "${p.highlight}" not found in ${p.ref} (${store!.abbreviation})`);
  }
}

export function validateDataset({ referents, traditions, stores, original }: Dataset): string[] {
  const errors: string[] = [];
  const dupes = (kind: string, list: { id: string }[]) => {
    const seen = new Set<string>();
    for (const { id } of list) {
      if (seen.has(id)) errors.push(`duplicate ${kind} id "${id}"`);
      seen.add(id);
    }
  };
  dupes("referent", referents);
  const seenOriginal = new Set<string>();
  for (const e of original.entries) {
    if (seenOriginal.has(e.ref)) errors.push(`original.yaml: duplicate entry for ${e.ref}`);
    seenOriginal.add(e.ref);
    if (expandRef(e.ref).length !== 1) errors.push(`original.yaml: ${e.ref} must be a single verse`);
    if (!e.words.some((w) => w.focus)) errors.push(`original.yaml: ${e.ref} has no focus word`);
  }
  const referentIds = new Set(referents.map((r) => r.id));

  for (const t of traditions) {
    const { meta, model } = t;
    const tid = meta.tradition.id;
    const err = (msg: string) => (errors.push(`[${tid}] ${msg}`), false);
    const cats = categoryIndex(meta);
    const rels = new Map(meta.relationships.map((r) => [r.id, r]));
    const nodes = new Map(model.nodes.map((n) => [n.id, n]));
    const tiers = new Set(meta.tradition.tiers.map((x) => x.id));

    dupes(`${tid} category`, meta.categories);
    dupes(`${tid} relationship`, meta.relationships);
    dupes(`${tid} node/edge`, [...model.nodes, ...model.edges]);

    for (const c of meta.categories) {
      if (c.parent && !cats.has(c.parent)) err(`category ${c.id}: unknown parent "${c.parent}"`);
      const path = categoryPath(meta, c.id);
      if (path[path.length - 1]?.id !== c.id) err(`category ${c.id}: cycle in parent chain`);
    }

    const categoryWords = new Map<string, string>();
    for (const c of meta.categories) for (const w of [...words(c.id), ...words(c.label)]) categoryWords.set(w, c.id);

    for (const r of meta.relationships) {
      for (const d of [...r.domain, ...r.range]) if (!cats.has(d)) err(`relationship ${r.id}: unknown category "${d}"`);
      for (const w of new Set([...words(r.id), ...words(r.label)])) {
        const cat = categoryWords.get(w);
        if (cat) err(`relationship ${r.id}: name embeds category word "${w}" (from ${cat}); use an atomic verb`);
      }
      const extra = rawWords(r.id)
        .slice(1)
        .filter((w) => !VERB_PARTICLES.has(w));
      if (extra.length)
        err(`relationship ${r.id}: name must be a single verb (+ preposition); move "${extra.join(" ")}" into an element or attribute`);
    }

    const referentOwner = new Map<string, string>();
    for (const n of model.nodes) {
      if (!cats.has(n.category)) err(`node ${n.id}: unknown category "${n.category}"`);
      if (!referentIds.has(n.referent)) err(`node ${n.id}: unknown referent "${n.referent}"`);
      const prev = referentOwner.get(n.referent);
      if (prev) err(`node ${n.id}: referent "${n.referent}" already used by ${prev} (one individual per referent)`);
      referentOwner.set(n.referent, n.id);
    }

    const inDomain = (rel: { id: string; domain: string[] }, cat: string, what: string) =>
      rel.domain.some((d) => isA(meta, cat, d)) || err(`${what}: ${cat} not in domain of ${rel.id} [${rel.domain}]`);
    const inRange = (rel: { id: string; range: string[] }, cat: string, what: string) =>
      rel.range.some((d) => isA(meta, cat, d)) || err(`${what}: ${cat} not in range of ${rel.id} [${rel.range}]`);
    const knownCat = (cat: string | undefined, what: string) => !cat || cats.has(cat) || err(`${what}: unknown category "${cat}"`);

    for (const e of model.edges) {
      const what = `edge ${e.id}`;
      const rel = rels.get(e.rel);
      const src = nodes.get(e.source);
      if (!rel) err(`${what}: unknown relationship "${e.rel}"`);
      if (!src) err(`${what}: unknown source node "${e.source}"`);
      knownCat(e.asTo, `${what} asTo`);
      if (e.target && !nodes.has(e.target)) err(`${what}: unknown target node "${e.target}"`);
      const tgtCat = e.target ? nodes.get(e.target)?.category : knownCat(e.targetKind, `${what} targetKind`) && e.targetKind;
      if (rel && src) inDomain(rel, src.category, what);
      if (rel && tgtCat) inRange(rel, tgtCat, what);
    }

    dupes(`${tid} axiom`, meta.axioms);
    for (const a of meta.axioms) {
      const what = `axiom ${a.id}`;
      const rel = rels.get(a.rel);
      if (!rel) err(`${what}: unknown relationship "${a.rel}"`);
      const ok = knownCat(a.source, `${what} source`) && knownCat(a.target, `${what} target`);
      if (rel && ok) {
        inDomain(rel, a.source, what);
        inRange(rel, a.target, what);
      }
    }

    const bibleStore = stores[meta.tradition.scripture.bible];
    const otherStore = stores[meta.tradition.scripture.other];
    if (!bibleStore) err(`unknown scripture store "${meta.tradition.scripture.bible}"`);
    if (!otherStore) err(`unknown scripture store "${meta.tradition.scripture.other}"`);
    for (const { owner, citations } of allCitations(t)) {
      for (const a of citations.authority)
        if (!tiers.has(a.tier)) err(`${owner}: unknown authority tier "${a.tier}" (${a.source})`);
      validateScripture(citations.scripture.bible, bibleStore, owner, err);
      validateScripture(citations.scripture.other, otherStore, owner, err);
    }
  }
  return errors;
}
