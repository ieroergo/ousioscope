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

/** Tradition-topic ids (from the tradition's own outline) that an element belongs to. */
const TopicIds = z.array(id).optional();

export const Attribute = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  topics: TopicIds,
  citations: Citations,
});

export const Tier = z.object({ id, label: z.string() });

export const Category = z.object({
  id,
  label: z.string(),
  parent: id.optional(),
  group: z.boolean().optional(),
  definition: z.string(),
  topics: TopicIds,
  citations: Citations,
});

export const RelationshipType = z.object({
  id,
  label: z.string(),
  definition: z.string(),
  domain: z.array(id).min(1),
  range: z.array(id).min(1),
  /** Outline topics this kind of statement belongs to. Every edge inherits these, so the data is organized by topic. */
  topics: z.array(id).min(1),
  citations: Citations,
});

/**
 * One point of the tradition's own outline of teaching (e.g. a Catechism section, a Westminster chapter, an Article
 * of Faith, one of the usul al-din), in its own words and with its own source. `registry` maps it to shared topics.
 */
export const Topic = z.object({
  id,
  label: z.string().min(1),
  registry: z.array(id).min(1),
  /** false for topics the model covers but the tradition's headline outline does not list. */
  inOutline: z.boolean().default(true),
  source: Authority,
});

/** This tradition's own stance on a shared debate proposition, cited to its own sources. */
export const Stance = z.object({
  debate: id,
  stance: z.enum(["affirms", "rejects", "condemns", "reframes", "none"]),
  summary: z.string().min(1),
  citations: Citations.optional(),
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
    /** The tradition's own stated rule for interpreting scripture. Used when checking a claim's scripture support. */
    hermeneutic: z.object({ summary: z.string().min(1), citations: z.lazy(() => Citations) }),
    /** Domains the claim validator may use as sources for this tradition (its own official and primary-text sites). */
    allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).min(1),
  }),
  /** The tradition's own outline of teaching. Data is organized around these topics. */
  topics: z.array(Topic).min(1),
  stances: z.array(Stance).default([]),
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
    /** Extra outline topics beyond those inherited from the relationship type. */
    topics: TopicIds,
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

/**
 * Shared topic registry: neutral names that let two traditions' outlines line up (matched by name, like referents).
 * Subjects are not listed here; every referent is automatically a subject topic.
 */
export const RegistryTopic = z.object({
  id,
  kind: z.enum(["doctrine", "salvation", "life", "debate"]),
  label: z.string().min(1),
  /** For debates: what the disputed question is usually called (e.g. "Arian controversy"). */
  known: z.string().optional(),
  description: z.string().optional(),
});
export const TopicRegistry = z.object({ topics: z.array(RegistryTopic) });

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
export type Topic = z.infer<typeof Topic>;
export type Stance = z.infer<typeof Stance>;
export type RegistryTopic = z.infer<typeof RegistryTopic>;

export interface Tradition {
  meta: Metamodel;
  model: Model;
}

export type PassageRef = z.infer<typeof PassageRef>;
export type PassageItem = z.infer<typeof PassageItem>;
export type ScriptureStore = z.infer<typeof ScriptureStore>;
export type OriginalEntry = z.infer<typeof OriginalEntry>;
export type OriginalFile = z.infer<typeof OriginalFile>;

/** "tradition:Category", or just "tradition" when `match` is "none". */
const CategoryRef = z.string().regex(/^[a-z][\w-]*(:[A-Za-z][\w.-]*)?$/, 'category refs look like "lds:Element"');

/**
 * A curated crosswalk between two traditions' categories. Crosswalks live outside the tradition models so each
 * model stays in its own vocabulary. `match` describes `a` relative to `b`.
 */
export const Crosswalk = z.object({
  id,
  a: CategoryRef,
  b: CategoryRef,
  match: z.enum(["close", "broader", "narrower", "related", "none"]),
  /** What the two categories share, or for "none" why there is no counterpart. */
  note: z.string().min(1),
  /** The point where the traditions part ways. This is usually the interesting part. */
  differsOn: z.string().optional(),
  /**
   * tradition: an authority of one tradition addresses the other's concept. scholarly: comparative scholarship.
   * editorial: our mapping, justified only by each side's own cited definition (always shown alongside).
   */
  basis: z.enum(["tradition", "scholarly", "editorial"]),
  sources: z.array(Authority).default([]),
});
export const Crosswalks = z.object({ crosswalks: z.array(Crosswalk) });
export type Crosswalk = z.infer<typeof Crosswalk>;

export interface Dataset {
  referents: Referent[];
  traditions: Tradition[];
  stores: Record<string, ScriptureStore>;
  original: OriginalFile;
  crosswalks: Crosswalk[];
  topics: RegistryTopic[];
}
