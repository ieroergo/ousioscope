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
  const modeled = edges.size + attributes.length + axioms.size > 0 || (!!stance && stance.stance !== "none");
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

/** Short per-side status glyph for the topic picker. */
export function statusGlyph(c: TopicCoverage, kind: FocusKind): string {
  if (kind === "debate") {
    const s = c.stance?.stance;
    return s === "affirms" ? "✓" : s === "rejects" || s === "condemns" ? "✗" : s === "reframes" ? "≈" : "·";
  }
  return c.status === "modeled" ? "●" : c.status === "outline" ? "◐" : "○";
}
