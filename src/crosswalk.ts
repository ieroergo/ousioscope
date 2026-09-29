import { splitCategoryRef } from "./ontology";
import type { Crosswalk, Referent, Tradition } from "./schema";

export type Match = Crosswalk["match"];

/** A crosswalk between the left and right traditions' categories, oriented left → right. */
export interface CrosswalkLink {
  id: string;
  /** Either side is absent when the other side's category has no counterpart ("none"). */
  left?: string;
  right?: string;
  /** Left relative to right. */
  match: Match;
  curated?: Crosswalk;
  /** Referents placed in `left` by one tradition and in `right` by the other. */
  referents: string[];
}

const INVERT: Record<Match, Match> = { close: "close", broader: "narrower", narrower: "broader", related: "related", none: "none" };

export const MATCH_LABEL: Record<Match, string> = {
  close: "close match",
  broader: "broader than",
  narrower: "narrower than",
  related: "related",
  none: "no counterpart",
};

/**
 * Curated crosswalks between the two traditions, plus links derived from shared referents: when a referent is
 * in category X in one tradition and Y in the other, X and Y are linked with that referent as evidence.
 * Derived links add no judgment of their own. They only restate what both models already say.
 */
export function crosswalkLinks(left: Tradition, right: Tradition, curated: Crosswalk[], referents: Referent[]): CrosswalkLink[] {
  const L = left.meta.tradition.id;
  const R = right.meta.tradition.id;
  const links = new Map<string, CrosswalkLink>();
  for (const cw of curated) {
    const a = splitCategoryRef(cw.a);
    const b = splitCategoryRef(cw.b);
    let link: CrosswalkLink | undefined;
    if (a.tradition === L && b.tradition === R)
      link = { id: cw.id, left: a.category!, right: b.category, match: cw.match, curated: cw, referents: [] };
    else if (a.tradition === R && b.tradition === L)
      link = { id: cw.id, left: b.category, right: a.category, match: INVERT[cw.match], curated: cw, referents: [] };
    if (link) links.set(link.left && link.right ? `${link.left}|${link.right}` : cw.id, link);
  }
  const order = new Map(referents.map((r, i) => [r.id, i]));
  for (const ln of left.model.nodes) {
    if (!ln.referent) continue;
    const rn = right.model.nodes.find((n) => n.referent === ln.referent);
    if (!rn) continue;
    const key = `${ln.category}|${rn.category}`;
    const link = links.get(key) ?? { id: `derived:${key}`, left: ln.category, right: rn.category, match: "related" as Match, referents: [] };
    link.referents.push(ln.referent);
    links.set(key, link);
  }
  for (const l of links.values()) l.referents.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
  return [...links.values()];
}
