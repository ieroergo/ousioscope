import { resolveClaimRef } from "./ontology";
import type { Referent, RegistryTopic, Stance, Topic, Tradition } from "./schema";

export type FocusKind = "subject" | RegistryTopic["kind"];

/** Something the top-bar focus can point at: a subject (referent) or a registry topic. */
export interface FocusTopic {
  id: string;
  kind: FocusKind;
  label: string;
  known?: string;
}

export const KIND_LABEL: Record<FocusKind, string> = {
  subject: "Subjects",
  doctrine: "Doctrine",
  salvation: "Salvation",
  life: "Life & worship",
  debate: "Points of debate",
};

export const focusTopics = (referents: Referent[], registry: RegistryTopic[]): FocusTopic[] => [
  ...referents.map((r) => ({ id: r.id, kind: "subject" as const, label: r.canonical })),
  ...registry.map((t) => ({ id: t.id, kind: t.kind, label: t.label, known: t.known })),
];

/** What one tradition says under one registry topic: its outline items, its stance, and the modeled claims. */
export interface TopicCoverage {
  items: Topic[];
  stance?: Stance;
  nodes: Set<string>;
  edges: Set<string>;
  attributes: { node: string; name: string }[];
  categories: Set<string>;
  axioms: Set<string>;
  /** modeled: claims exist · outline: named in the tradition's outline but not modeled yet · absent: neither. */
  status: "modeled" | "outline" | "absent";
}

const meets = (a: string[] | undefined, b: Set<string>) => !!a?.some((x) => b.has(x));

export function topicCoverage(t: Tradition, registryId: string): TopicCoverage {
  const { meta, model } = t;
  const items = meta.topics.filter((x) => x.registry.includes(registryId));
  const own = new Set(items.map((x) => x.id));
  const relTopics = new Map(meta.relationships.map((r) => [r.id, r.topics]));
  const edges = new Set<string>();
  const nodes = new Set<string>();
  const categories = new Set<string>();
  const attributes: TopicCoverage["attributes"] = [];
  for (const e of model.edges) {
    if (!meets(relTopics.get(e.rel), own) && !meets(e.topics, own)) continue;
    edges.add(e.id);
    nodes.add(e.source);
    if (e.target) nodes.add(e.target);
    if (e.targetKind) categories.add(e.targetKind);
  }
  for (const n of model.nodes)
    for (const a of n.attributes ?? [])
      if (meets(a.topics, own)) {
        attributes.push({ node: n.id, name: a.name });
        nodes.add(n.id);
      }
  for (const c of meta.categories) if (meets(c.topics, own)) categories.add(c.id);
  const axioms = new Set(meta.axioms.filter((a) => meets(relTopics.get(a.rel), own)).map((a) => a.id));
  const stance = meta.stances.find((s) => s.debate === registryId);
  // A debate's graph coverage is exactly the claims its stance links to.
  for (const ref of stance?.claims ?? []) {
    const c = resolveClaimRef(t, ref);
    if (!c) continue;
    if (c.kind === "edge") {
      const e = model.edges.find((x) => x.id === c.id)!;
      edges.add(e.id);
      nodes.add(e.source);
      if (e.target) nodes.add(e.target);
      if (e.targetKind) categories.add(e.targetKind);
    } else if (c.kind === "node") nodes.add(c.id);
    else if (c.kind === "attribute") {
      attributes.push({ node: c.id, name: c.name });
      nodes.add(c.id);
    } else if (c.kind === "axiom") axioms.add(c.id);
    else categories.add(c.id);
  }
  const modeled = edges.size + attributes.length + axioms.size + categories.size > 0;
  return {
    items,
    stance,
    nodes,
    edges,
    attributes,
    categories,
    axioms,
    status: modeled ? "modeled" : items.length ? "outline" : "absent",
  };
}

/** Registry topics (and their tradition labels) that an edge or attribute belongs to, for topic chips. */
export function elementTopics(t: Tradition, own: string[] | undefined): { item: Topic; registry: string }[] {
  const items = t.meta.topics.filter((x) => own?.includes(x.id));
  return items.map((item) => ({ item, registry: item.registry[0] }));
}

export const edgeTopicIds = (t: Tradition, edgeId: string) => {
  const e = t.model.edges.find((x) => x.id === edgeId);
  if (!e) return [];
  const rel = t.meta.relationships.find((r) => r.id === e.rel);
  return [...new Set([...(rel?.topics ?? []), ...(e.topics ?? [])])];
};

/**
 * Graph element ids that represent a coverage in a given rendering: individuals, edges, «kind» and category
 * nodes, and (for the metamodel view) categories, relationship types, and class-level statements.
 */
export function spotlightIds(t: Tradition, c: Pick<TopicCoverage, "nodes" | "edges" | "categories" | "axioms">, view: "model" | "metamodel"): Set<string> {
  const out = new Set<string>();
  if (view === "model") {
    c.nodes.forEach((id) => out.add(id));
    c.edges.forEach((id) => out.add(id));
    c.categories.forEach((id) => (out.add(`kind:${id}`), out.add(`cat:${id}`)));
    return out;
  }
  const nodeCat = new Map(t.model.nodes.map((n) => [n.id, n.category]));
  c.nodes.forEach((id) => nodeCat.has(id) && out.add(`cat:${nodeCat.get(id)}`));
  c.categories.forEach((id) => out.add(`cat:${id}`));
  c.axioms.forEach((id) => out.add(`ax:${id}`));
  for (const e of t.model.edges.filter((x) => c.edges.has(x.id))) out.add(`relType:${e.rel}`);
  return out;
}

/** "Catholic's", "Jehovah's Witnesses'". */
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
