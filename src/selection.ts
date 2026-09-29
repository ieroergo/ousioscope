import { isA, versesCited } from "./ontology";
import type { Tradition } from "./schema";

export type Side = "left" | "right";
export type Mark = "selected" | "bridged" | "hit";
export type Selection =
  | { side: Side; kind: "node" | "edge" | "category" | "rel" | "axiom"; id: string }
  | { kind: "referent" | "verse"; id: string; side?: undefined };

/** The referent a selection points at, if any (used to bridge to the other tradition). */
export function selectedReferent(sel: Selection | null, traditions: Record<Side, Tradition>): string | undefined {
  if (!sel) return;
  if (sel.kind === "referent") return sel.id;
  if (sel.kind === "node") return traditions[sel.side].model.nodes.find((n) => n.id === sel.id)?.referent;
}

export function marksFor(side: Side, t: Tradition, sel: Selection | null, referent?: string): Map<string, Mark> {
  const marks = new Map<string, Mark>();
  if (!sel) return marks;
  const { meta, model } = t;
  if (sel.kind === "verse") {
    for (const c of versesCited(t).get(sel.id) ?? []) marks.set(c.id, "hit");
    return marks;
  }
  if (sel.side === side) {
    marks.set(sel.id, "selected");
    if (sel.kind === "category")
      model.nodes.filter((n) => isA(meta, n.category, sel.id)).forEach((n) => marks.set(n.id, "hit"));
    if (sel.kind === "rel")
      [...model.edges, ...meta.axioms].filter((e) => e.rel === sel.id).forEach((e) => marks.set(e.id, "hit"));
    return marks;
  }
  if (referent) model.nodes.filter((n) => n.referent === referent).forEach((n) => marks.set(n.id, "bridged"));
  return marks;
}
