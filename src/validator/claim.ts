import { categoryPath, describeAxiom, describeEdge, passageText } from "../ontology";
import type { Citations, OriginalEntry, PassageItem, RegistryTopic, ScriptureStore, Tradition } from "../schema";
import { expandRef, flattenPassages } from "../scripture";

/** What a claim is about, identified by its id in the tradition's data. */
export type ClaimTarget =
  | { kind: "node"; id: string }
  | { kind: "attribute"; id: string; name: string }
  | { kind: "edge"; id: string }
  | { kind: "axiom"; id: string }
  | { kind: "category"; id: string }
  | { kind: "stance"; id: string };

export interface ClaimPassage {
  ref: string;
  translation: string;
  text?: string;
  original?: string;
}

/** One atomic, self-contained proposition attributed to one tradition, with everything cited for it. */
export interface AtomicClaim {
  key: string;
  tradition: { id: string; name: string };
  statement: string;
  context?: string;
  authorities: { source: string; ref?: string; tier: string; url?: string; quote?: string }[];
  scripture: ClaimPassage[];
  bibleRole: "canonical" | "parallel";
  hermeneutic: string;
  allowedDomains: string[];
}

export const claimKey = (tid: string, t: ClaimTarget) => `${tid}:${t.kind}:${t.id}${t.kind === "attribute" ? `:${t.name}` : ""}`;

/** Builds the claim, or undefined if the target no longer exists (e.g. after switching traditions). */
export function buildClaim(
  t: Tradition,
  target: ClaimTarget,
  stores: Record<string, ScriptureStore>,
  original: Map<string, OriginalEntry>,
  topics: RegistryTopic[] = [],
): AtomicClaim | undefined {
  const { meta, model } = t;
  const name = meta.tradition.name;
  const catLabel = (id: string) => categoryPath(meta, id).map((c) => c.label).join(" › ");
  let statement: string;
  let context: string | undefined;
  let citations: Citations;
  switch (target.kind) {
    case "node": {
      const n = model.nodes.find((x) => x.id === target.id);
      if (!n) return;
      statement = `${n.label} is a ${catLabel(n.category)}.${n.description ? ` ${n.description}` : ""}`;
      citations = n.citations;
      break;
    }
    case "attribute": {
      const n = model.nodes.find((x) => x.id === target.id);
      const a = n?.attributes?.find((x) => x.name === target.name);
      if (!n || !a) return;
      statement = `${n.label}: ${a.name}: ${a.value}.`;
      citations = a.citations;
      break;
    }
    case "edge": {
      const e = model.edges.find((x) => x.id === target.id);
      if (!e) return;
      const d = describeEdge(t, e);
      statement = `${d.source} ${d.verb} ${d.target}${d.asTo ? `, as to ${d.asTo}` : ""}.`;
      const rel = meta.relationships.find((r) => r.id === e.rel);
      context = [rel && `"${rel.label}" here means: ${rel.definition}`, e.note].filter(Boolean).join(" ");
      citations = e.citations;
      break;
    }
    case "axiom": {
      const a = meta.axioms.find((x) => x.id === target.id);
      if (!a) return;
      const d = describeAxiom(meta, a);
      statement = `${d.source} ${d.verb} ${d.target}.`;
      context = a.note;
      citations = a.citations;
      break;
    }
    case "stance": {
      const st = meta.stances.find((x) => x.debate === target.id);
      const d = topics.find((x) => x.id === target.id);
      if (!st?.citations || !d) return;
      const verb = { affirms: "Affirms", rejects: "Rejects", condemns: "Condemns as heresy", reframes: "Reframes", none: "Takes no position on" }[st.stance];
      statement = `${verb} the proposition "${d.label}"${d.known ? ` (${d.known})` : ""}. ${st.summary}`;
      citations = st.citations;
      break;
    }
    case "category": {
      const c = meta.categories.find((x) => x.id === target.id);
      if (!c) return;
      statement = `"${c.label}" (${catLabel(c.id)}) is a category of being: ${c.definition}`;
      citations = c.citations;
      break;
    }
  }
  const bible = stores[meta.tradition.scripture.bible];
  const other = stores[meta.tradition.scripture.other];
  const passages = (items: PassageItem[] | "none-cited" | undefined, store?: ScriptureStore): ClaimPassage[] =>
    flattenPassages(items).map((p) => {
      const verses = expandRef(p.ref);
      const orig = store?.originals
        ? verses.map((v) => store.originals![v]).filter(Boolean).join(" ")
        : verses.map((v) => original.get(v)?.text).filter(Boolean).join(" ");
      return { ref: p.ref, translation: store?.abbreviation ?? "", text: passageText(store, p.ref), original: orig || undefined };
    });
  return {
    key: claimKey(meta.tradition.id, target),
    tradition: { id: meta.tradition.id, name },
    statement,
    context: context || undefined,
    authorities: citations.authority.map((a) => ({ ...a, tier: meta.tradition.tiers.find((x) => x.id === a.tier)?.label ?? a.tier })),
    scripture: [...passages(citations.scripture.bible, bible), ...passages(citations.scripture.other, other)],
    bibleRole: meta.tradition.bibleRole,
    hermeneutic: meta.tradition.hermeneutic.summary,
    allowedDomains: meta.tradition.allowedDomains,
  };
}
