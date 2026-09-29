import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z][\w.-]*$/, "ids must start with a letter and contain only letters, digits, _ . -");

export const Authority = z.object({
  source: z.string().min(1),
  ref: z.string().optional(),
  tier: z.string().min(1),
  url: z.url().optional(),
  quote: z.string().optional(),
});

/** A cited passage: "John 1:14" or { ref, highlight } where highlight is the exact relevant phrase. */
export const PassageRef = z.union([
  z.string().min(1),
  z.object({ ref: z.string().min(1), highlight: z.string().min(1).optional() }),
]);

/** Passages that support a claim only when read together (e.g. prophecy + fulfillment). */
export const PassageGroup = z.object({
  together: z.array(PassageRef).min(2),
  note: z.string().min(1),
});

export const PassageItem = z.union([PassageRef, PassageGroup]);

export const Scripture = z.object({
  bible: z.union([z.array(PassageItem).min(1), z.literal("none-cited")]),
  other: z.array(PassageItem).optional(),
});

/** Verse texts from one translation / publisher, keyed by single-verse ref ("John 1:14"). */
export const ScriptureStore = z.object({
  id,
  name: z.string(),
  abbreviation: z.string(),
  publisher: z.string(),
  copyright: z.string(),
  chapters: z.record(z.string(), z.url()),
  verses: z.record(z.string(), z.string().min(1)),
  /** Original-language text per verse, when the store carries it (e.g. Arabic for the Qur'an). */
  originals: z.record(z.string(), z.string()).optional(),
  originalLang: z.enum(["ar", "grc", "hbo"]).optional(),
});

export const OriginalWord = z.object({
  form: z.string(),
  translit: z.string(),
  lemma: z.string(),
  strongs: z.string().optional(),
  morph: z.string(),
  parse: z.string(),
  gloss: z.string(),
  focus: z.boolean().optional(),
});

/** Original-language evidence for one verse (curated where a claim depends on the wording). */
export const OriginalEntry = z.object({
  ref: z.string(),
  lang: z.enum(["grc", "hbo"]),
  source: z.string(),
  text: z.string(),
  why: z.string(),
  words: z.array(OriginalWord).min(1),
  quotes: z.string().optional(),
  textusReceptus: z.object({ agrees: z.boolean(), text: z.string(), note: z.string().optional() }).optional(),
  novaVulgata: z.object({ text: z.string(), url: z.url() }).optional(),
});

export const OriginalFile = z.object({ attribution: z.array(z.string()), entries: z.array(OriginalEntry) });

export const Citations = z.object({
  scripture: Scripture,
  authority: z.array(Authority).min(1),
});

export const Attribute = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  citations: Citations,
});

export const Tier = z.object({ id, label: z.string() });

export const Category = z.object({
  id,
  label: z.string(),
  parent: id.optional(),
  group: z.boolean().optional(),
  definition: z.string(),
  citations: Citations,
});

export const RelationshipType = z.object({
  id,
  label: z.string(),
  definition: z.string(),
  domain: z.array(id).min(1),
  range: z.array(id).min(1),
  citations: Citations,
});

/**
 * How a relationship refers to a category (kind) rather than to a named individual:
 * - some: at least one (unnamed) member of the kind, e.g. "assumes some human nature" (existential)
 * - all:  every member of the kind (universal quantification)
 * - kind: the kind / universal itself, e.g. "human nature in general"
 */
export const Quantifier = z.enum(["some", "all", "kind"]);

/** Class-level (TBox) statement: every member of `source` stands in `rel` to `quantifier` `target`. */
export const Axiom = z.object({
  id,
  source: id,
  rel: id,
  target: id,
  quantifier: Quantifier.default("some"),
  note: z.string().optional(),
  citations: Citations,
});

export const Metamodel = z.object({
  tradition: z.object({
    id,
    name: z.string(),
    shortName: z.string(),
    scripture: z.object({ bible: id, other: id }),
    /**
     * canonical: the Old and New Testaments are this tradition's scripture.
     * parallel: they are not (e.g. Islam); Bible verses are shown only as labeled parallels to its own scripture.
     */
    bibleRole: z.enum(["canonical", "parallel"]).default("canonical"),
    otherScriptureLabel: z.string(),
    tiers: z.array(Tier).min(1),
  }),
  categories: z.array(Category).min(1),
  relationships: z.array(RelationshipType).min(1),
  axioms: z.array(Axiom).default([]),
});

/** A named individual. Every individual is a registered referent (instance-level / ABox). */
export const Node = z.object({
  id,
  label: z.string(),
  category: id,
  referent: id,
  description: z.string().optional(),
  attributes: z.array(Attribute).optional(),
  citations: Citations,
});

/**
 * Instance-level statement from an individual to either another individual (`target`)
 * or a kind (`targetKind` + `quantifier`). `asTo` qualifies the respect in which it holds
 * (e.g. Chalcedon: begotten "as to his divinity", born "as to his humanity").
 */
export const Edge = z
  .object({
    id,
    source: id,
    rel: id,
    target: id.optional(),
    targetKind: id.optional(),
    quantifier: Quantifier.optional(),
    asTo: id.optional(),
    note: z.string().optional(),
    citations: Citations,
  })
  .refine((e) => !!e.target !== !!e.targetKind, { message: "edge needs exactly one of target or targetKind" })
  .refine((e) => !e.quantifier || !!e.targetKind, { message: "quantifier only applies to targetKind" });

export const Model = z.object({
  nodes: z.array(Node).min(1),
  edges: z.array(Edge),
});

export const Referent = z.object({
  id,
  canonical: z.string(),
  aliases: z.record(z.string(), z.array(z.string())),
});

export const Referents = z.object({ referents: z.array(Referent) });

export type Authority = z.infer<typeof Authority>;
export type Citations = z.infer<typeof Citations>;
export type Attribute = z.infer<typeof Attribute>;
export type Category = z.infer<typeof Category>;
export type RelationshipType = z.infer<typeof RelationshipType>;
export type Quantifier = z.infer<typeof Quantifier>;
export type Axiom = z.infer<typeof Axiom>;
export type Metamodel = z.infer<typeof Metamodel>;
export type Node = z.infer<typeof Node>;
export type Edge = z.infer<typeof Edge>;
export type Model = z.infer<typeof Model>;
export type Referent = z.infer<typeof Referent>;

export interface Tradition {
  meta: Metamodel;
  model: Model;
}

export type PassageRef = z.infer<typeof PassageRef>;
export type PassageItem = z.infer<typeof PassageItem>;
export type ScriptureStore = z.infer<typeof ScriptureStore>;
export type OriginalEntry = z.infer<typeof OriginalEntry>;
export type OriginalFile = z.infer<typeof OriginalFile>;

export interface Dataset {
  referents: Referent[];
  traditions: Tradition[];
  stores: Record<string, ScriptureStore>;
  original: OriginalFile;
}
