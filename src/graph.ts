import type { ElementDefinition } from "cytoscape";
import { bestTier, categoryIndex, categoryPath, describeAxiom, describeEdge } from "./ontology";
import type { Edge, Metamodel, Tradition } from "./schema";

export type View = "model" | "metamodel";

const PALETTE = ["#c9a227", "#5b8def", "#9b7fd4", "#3fa99a", "#d9735f", "#56a878", "#e0954a", "#7c8aa0"];

/** Color per group category, assigned in metamodel order so each tradition's divisions stay stable. */
export function groupColors(meta: Metamodel): Map<string, string> {
  const colors = new Map<string, string>();
  meta.categories.filter((c) => c.group).forEach((c, i) => colors.set(c.id, PALETTE[i % PALETTE.length]));
  return colors;
}

/** Nearest ancestor-or-self category flagged `group`. */
export function groupOf(meta: Metamodel, categoryId: string): string | undefined {
  return categoryPath(meta, categoryId)
    .reverse()
    .find((c) => c.group)?.id;
}

export const categoryColor = (meta: Metamodel, categoryId: string) =>
  groupColors(meta).get(groupOf(meta, categoryId) ?? "") ?? "#94a3b8";

/** Node ids within `hops` (undirected) of any node carrying `referent`; all nodes if no focus. */
export function neighborhood(t: Tradition, referent: string | null, hops: number): Set<string> {
  const { nodes, edges } = t.model;
  if (!referent) return new Set(nodes.map((n) => n.id));
  let frontier = new Set(nodes.filter((n) => n.referent === referent).map((n) => n.id));
  const seen = new Set(frontier);
  for (let i = 0; i < hops && frontier.size; i++) {
    const next = new Set<string>();
    for (const { source, target } of edges) {
      if (!target) continue;
      if (frontier.has(source) && !seen.has(target)) next.add(target);
      if (frontier.has(target) && !seen.has(source)) next.add(source);
    }
    next.forEach((n) => seen.add(n));
    frontier = next;
  }
  return seen;
}

/** How many degrees out the graph reaches from `referent` (0 if absent or unconnected). */
export function maxDegree(t: Tradition, referent: string): number {
  let prev = neighborhood(t, referent, 0).size;
  if (!prev) return 0;
  for (let d = 1; ; d++) {
    const size = neighborhood(t, referent, d).size;
    if (size === prev) return d - 1;
    prev = size;
  }
}

/** Edge label: verb, "as to" qualifier, and quantifier when the target is a kind. */
export function edgeLabel(t: Tradition, e: Edge) {
  const d = describeEdge(t, e);
  return [d.verb, e.targetKind && e.quantifier !== "kind" ? QUANT[e.quantifier ?? "some"] : "", d.asTo ? `· as to ${d.asTo}` : ""]
    .filter(Boolean)
    .join(" ");
}
const QUANT = { some: "some", all: "every", kind: "" } as const;

export const kindNodeId = (categoryId: string) => `kind:${categoryId}`;
export const categoryNodeId = (categoryId: string) => `cat:${categoryId}`;

/**
 * How category membership is drawn in the claims view:
 * containers: group categories as boxes around their members.
 * nodes: every category on a member's path is its own node, with "is a" edges (nothing is implicit).
 * color: node color only.
 */
export type Grouping = "containers" | "nodes" | "color";

export function modelElements(
  t: Tradition,
  visible: Set<string>,
  minTier: number,
  grouping: Grouping = "containers",
  /** When set (topic focus), only these edges are drawn. */
  edgeFilter?: Set<string>,
): ElementDefinition[] {
  const { meta, model } = t;
  const cats = categoryIndex(meta);
  const colors = groupColors(meta);
  const colorOf = (cid: string) => colors.get(groupOf(meta, cid) ?? "") ?? "#94a3b8";
  const usedGroups = new Set<string>();
  const usedCats = new Set<string>();
  const place = (categoryId: string) => {
    for (const c of categoryPath(meta, categoryId)) {
      if (c.group) usedGroups.add(c.id);
      usedCats.add(c.id);
    }
    const group = groupOf(meta, categoryId);
    return { parent: grouping === "containers" && group ? `grp:${group}` : undefined, color: colorOf(categoryId) };
  };
  const shown = model.nodes.filter((n) => visible.has(n.id));
  const nodes: ElementDefinition[] = shown.map((n) => ({
    data: { id: n.id, label: n.label, ...place(n.category) },
    classes: ["individual", bestTier(meta, n.citations) > minTier ? "faded" : ""].join(" "),
  }));
  const visibleEdges = model.edges.filter(
    (e) => visible.has(e.source) && (!e.target || visible.has(e.target)) && (!edgeFilter || edgeFilter.has(e.id)),
  );
  const kindIds = [...new Set(visibleEdges.flatMap((e) => (e.targetKind ? [e.targetKind] : [])))];
  kindIds.forEach(place);
  // With category nodes, a «kind» target is simply that category's node.
  const kindTarget = (cid: string) => (grouping === "nodes" ? categoryNodeId(cid) : kindNodeId(cid));
  const kinds: ElementDefinition[] =
    grouping === "nodes"
      ? []
      : kindIds.map((cid) => ({
          data: { id: kindNodeId(cid), label: `«${cats.get(cid)?.label ?? cid}»`, ...place(cid) },
          classes: "kind",
        }));
  const groups: ElementDefinition[] =
    grouping !== "containers"
      ? []
      : [...usedGroups].map((gid) => {
          const parent = groupOf(meta, cats.get(gid)?.parent ?? "");
          return {
            data: { id: `grp:${gid}`, label: cats.get(gid)!.label, parent: parent ? `grp:${parent}` : undefined, color: colors.get(gid) },
            classes: "group",
          };
        });
  const categoryNodes: ElementDefinition[] = [];
  if (grouping === "nodes") {
    for (const cid of usedCats) {
      const c = cats.get(cid)!;
      categoryNodes.push({ data: { id: categoryNodeId(cid), label: c.label, color: colorOf(cid) }, classes: "category-node" });
      if (c.parent) categoryNodes.push({ data: { id: `isa:${cid}`, source: categoryNodeId(cid), target: categoryNodeId(c.parent), label: "is a" }, classes: "isa" });
    }
    for (const n of shown)
      categoryNodes.push({ data: { id: `inst:${n.category}:${n.id}`, source: n.id, target: categoryNodeId(n.category), label: "is a" }, classes: "isa inst" });
  }
  const edges: ElementDefinition[] = visibleEdges.map((e) => ({
    data: { id: e.id, source: e.source, target: e.target ?? kindTarget(e.targetKind!), label: edgeLabel(t, e) },
    classes: [e.targetKind ? "to-kind" : "", bestTier(meta, e.citations) > minTier ? "faded" : ""].join(" "),
  }));
  return [...groups, ...nodes, ...kinds, ...categoryNodes, ...edges];
}

/**
 * The graph element that stands for a category in the current rendering, or its nearest drawn ancestor.
 * Used to anchor crosswalk lines.
 */
export function categoryAnchorIds(meta: Metamodel, categoryId: string, view: View, grouping: Grouping): string[] {
  const path = categoryPath(meta, categoryId).reverse(); // self first, then ancestors
  if (view === "metamodel" || grouping === "nodes") return path.map((c) => categoryNodeId(c.id));
  return path.flatMap((c) => [kindNodeId(c.id), ...(grouping === "containers" && c.group ? [`grp:${c.id}`] : [])]);
}

/**
 * `keep` (isolate mode) holds spotlight ids ("cat:", "relType:", "ax:"): only those categories, their ancestors
 * (so the tree still reads), the relationship types, and the class-level statements are drawn.
 */
export function metamodelElements({ meta }: Tradition, keep?: Set<string>): ElementDefinition[] {
  const colors = groupColors(meta);
  let kept: Set<string> | undefined;
  if (keep) {
    kept = new Set<string>();
    const addWithAncestors = (id: string) => categoryPath(meta, id).forEach((c) => kept!.add(c.id));
    meta.categories.filter((c) => keep.has(`cat:${c.id}`)).forEach((c) => addWithAncestors(c.id));
    for (const a of meta.axioms.filter((x) => keep.has(`ax:${x.id}`))) [a.source, a.target].forEach(addWithAncestors);
    for (const r of meta.relationships.filter((x) => keep.has(`relType:${x.id}`)))
      if (!r.domain.some((d) => kept!.has(d)) || !r.range.some((g) => kept!.has(g))) [r.domain[0], r.range[0]].forEach(addWithAncestors);
  }
  const has = (cid: string) => !kept || kept.has(cid);
  const nodes: ElementDefinition[] = meta.categories.filter((c) => has(c.id)).map((c) => ({
    data: {
      id: `cat:${c.id}`,
      label: c.label,
      color: colors.get(groupOf(meta, c.id) ?? "") ?? "#94a3b8",
    },
    classes: c.group ? "category group-category" : "category",
  }));
  const isa: ElementDefinition[] = meta.categories
    .filter((c) => c.parent && has(c.id) && has(c.parent))
    .map((c) => ({
      data: { id: `isa:${c.id}`, source: `cat:${c.id}`, target: `cat:${c.parent}`, label: "is a" },
      classes: "isa",
    }));
  const rels: ElementDefinition[] = meta.relationships
    .filter((r) => !keep || keep.has(`relType:${r.id}`))
    .flatMap((r) =>
      r.domain.flatMap((d) =>
        r.range
          .filter((g) => has(d) && has(g))
          .map((g) => ({
            data: { id: `rel:${r.id}:${d}:${g}`, source: `cat:${d}`, target: `cat:${g}`, label: r.label },
            classes: "reltype",
          })),
      ),
    );
  const axioms: ElementDefinition[] = meta.axioms.filter((a) => !keep || keep.has(`ax:${a.id}`)).map((a) => {
    const d = describeAxiom(meta, a);
    return {
      data: { id: `ax:${a.id}`, source: `cat:${a.source}`, target: `cat:${a.target}`, label: `${d.verb} ${QUANT[a.quantifier]}`.trim() },
      classes: "axiom",
    };
  });
  return [...nodes, ...isa, ...rels, ...axioms];
}
