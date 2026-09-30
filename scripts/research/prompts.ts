import { stringify } from "yaml";
import type { Referent, RegistryTopic, Tradition } from "../../src/schema";
import { BOOKS, RESTORATION } from "../books";
import type { QuoteCheck } from "./verify";
import type { CriticOutput, Finding, ReconcileOutput, ResearchOutput } from "./schemas";

export interface Focus {
  id: string;
  kind: "subject" | RegistryTopic["kind"];
  label: string;
  known?: string;
}

const PROJECT = `Ousioscope is a comparative-religion research tool. It represents what each tradition says things ARE
(its ontology), strictly in that tradition's own words, cited to that tradition's own sources, and never judges
whether a teaching is true.`;

function traditionBlock(t: Tradition) {
  const tr = t.meta.tradition;
  return [
    `TRADITION: ${tr.name}`,
    `AUTHORITY TIERS (highest first): ${tr.tiers.map((x) => `${x.id} = ${x.label}`).join("; ")}`,
    `ITS OWN RULE OF INTERPRETATION: ${tr.hermeneutic.summary}`,
    tr.bibleRole === "parallel"
      ? `SCRIPTURE: its scripture is the ${tr.otherScriptureLabel}. The Bible is NOT its scripture (cite Bible verses only as labeled parallels).`
      : `SCRIPTURE: the Bible (Old and New Testaments), plus ${tr.otherScriptureLabel}.`,
    `ALLOWED SOURCES (only these domains): ${tr.allowedDomains.join(", ")}`,
  ].join("\n");
}

function focusBlock(f: Focus, t: Tradition, referents: Referent[]) {
  const aliases = referents.find((r) => r.id === f.id)?.aliases[t.meta.tradition.id];
  const others = referents.filter((r) => r.id !== f.id).map((r) => r.canonical);
  if (f.kind === "debate")
    return `TOPIC (point of debate): the proposition "${f.label}"${f.known ? ` (known as: ${f.known})` : ""}.
Determine ${t.meta.tradition.name}'s own position: affirms | rejects | condemns (as heresy) | reframes (keeps the words but
redefines them) | none (no stated position). Also find the teachings that ground that position.`;
  if (f.kind === "subject")
    return `TOPIC (subject): ${f.label}${aliases?.length ? ` (in this tradition also called: ${aliases.join(", ")})` : ""}.
Find what ${t.meta.tradition.name} teaches this being IS: its nature or kind, origin, titles, attributes, and its relations to
God and to other beings (${others.join(", ")}). Include teachings the tradition explicitly rejects about it.`;
  return `TOPIC: ${f.label}. Find what ${t.meta.tradition.name} teaches on this topic, as it bears on what things are.`;
}

export function researcherPrompt(f: Focus, t: Tradition, referents: Referent[]) {
  return `${PROJECT}

You are the BLIND RESEARCHER. You have not seen and must not look for this project's existing data. Research from primary
sources only.

${traditionBlock(t)}

${focusBlock(f, t, referents)}

HOW TO WORK
- Search only the allowed domains (use site: filters) and read the pages themselves. Prefer the highest authority tiers.
- One atomic teaching per finding, in the tradition's own vocabulary. Never import another tradition's terms.
- Every finding needs at least one source whose "quote" is copied VERBATIM from the page at that exact URL. Quotes are
  machine-checked against the live page; anything that does not match is discarded. Use "..." for omissions.
- List scripture the source itself cites for the teaching (e.g. "Luke 1:43", "Quran 19:20"). Don't add your own proof texts.
- Report what the tradition teaches, including where it rejects a term or a doctrine. Do not evaluate truth.
- Aim for 5-15 findings, highest authority first. Put anything you looked for but could not source in "gaps".`;
}

const verifiedFindings = (r: ResearchOutput, checks: QuoteCheck[]) =>
  r.findings.map((f) => ({
    ...f,
    sources: f.sources.map((s) => ({ ...s, verification: checks.find((c) => c.url === s.url && c.quote === s.quote)?.status ?? "unchecked" })),
  }));

export function reconcilePrompt(f: Focus, t: Tradition, r: ResearchOutput, checks: QuoteCheck[], registry: RegistryTopic[], referents: Referent[]) {
  return `${PROJECT}

You are the RECONCILER. A blind researcher produced findings (below) without seeing the project's data. Map each finding
onto the tradition's EXISTING model and metamodel, and say what would have to change.

${traditionBlock(t)}

${focusBlock(f, t, referents)}

FINDINGS (with machine verification of each quote; only "verified" sources may be relied on):
${stringify({ summary: r.summary, stance: r.stance, findings: verifiedFindings(r, checks), gaps: r.gaps })}

THE TRADITION'S CURRENT METAMODEL (categories, relationship types, outline topics, stances, axioms):
${stringify(t.meta)}

THE TRADITION'S CURRENT MODEL (individuals and edges):
${stringify(t.model)}

SHARED REGISTRY (subjects = referents; topics and debate propositions):
${stringify({ referents: referents.map((x) => ({ id: x.id, canonical: x.canonical })), topics: registry.map((x) => ({ id: x.id, kind: x.kind, label: x.label })) })}

For each finding give a status:
- already_modeled: an existing node/edge/attribute/stance says this (list ids).
- refines: an existing element is incomplete or imprecise and should be edited (list ids, say how).
- conflicts: an existing element contradicts the finding (list ids, explain).
- new: nothing covers it; propose the element in the model's terms (individual, attribute, edge with relationship type,
  axiom, stance, claim links).
- out_of_scope: not about what things are (e.g. pure ethics or practice).
List new categories or relationship types only if the tradition's own vocabulary requires them and no existing one fits.`;
}

export function criticPrompt(f: Focus, t: Tradition, r: ResearchOutput, checks: QuoteCheck[], rec: ReconcileOutput, referents: Referent[]) {
  return `${PROJECT}

You are the CRITIC. Challenge the findings and proposed changes below by ${t.meta.tradition.name}'s OWN standards. Do not
argue from other traditions.

${traditionBlock(t)}

${focusBlock(f, t, referents)}

FINDINGS (with machine verification of each quote):
${stringify(verifiedFindings(r, checks))}

PROPOSED CHANGES (from the reconciler):
${stringify(rec)}

FOR EACH FINDING
1. Interior critique: fidelity (does the tradition teach this, at the stated authority tier, or is it overstated?), citation
   (does the source say this in context?), scripture (is the verse read the way the tradition's own authorities read it,
   under its rule of interpretation?).
2. Internal dissent: real disagreement inside the tradition (schools, earlier vs. current teaching, weaker vs. stronger
   gradings, official vs. popular teaching). Record it so the model does not flatten it.
3. Objections: blocking (would put a false or misattributed claim in the model), major, minor.
Also list important teachings the researcher MISSED on this topic.

You may read and search the allowed domains to check. Every source you give needs a VERBATIM quote from the page at that
exact URL; quotes are machine-checked.`;
}

export const JUDGE_RULES = `RULES FOR CHANGES
- Accept a finding only if it rests on at least one VERIFIED quote and survives blocking objections. Otherwise reject it
  and say why.
- A verified quote proves retrieval, not support. It must support the exact claim in context; a dissenting passage cannot
  serve as the sole support for the position it challenges. Do not expand a source into claims it does not make.
- A failed fetch is a verification gap, not doctrinal disagreement. A source's silence is not an explicit rejection;
  use stance none when no stated position can be sourced, rather than filling every debate by inference.
- Any "quote" you write into an authority entry must be copied exactly from a verified quote below; if none fits, omit
  the quote field. Unverifiable quotes are stripped automatically.
- Use the tradition's own vocabulary and its existing ids, categories, relationship types, and tier ids. Add a category or
  relationship type only if nothing existing fits (and give it definition, domain, range, topics, citations).
- Every new category needs "term": kind own (a verbatim quote from a verified source that contains the category
  label's word, with its url, or a scripture ref) or kind editorial (a note on why no source term exists). Name
  categories with the source's own wording.
- Every individual needs a registered referent (existing id, or add_referent first). Every relationship type needs
  "topics" (the tradition's own outline topic ids).
- Debates: set_stance with position, summary, citations, and "claims" linking the modeled claims that express it
  ("<node or edge id>", "<node id>#<Attribute name>", "axiom:<id>", "category:<id>").
- Prefer editing (replace_node / replace_edge) over adding a near-duplicate. Keep changes minimal and atomic.
- Record unresolved objections and internal dissent in dissent_notes; if dissent is itself a teaching, it may belong in an
  attribute or edge note.
- Scripture refs use the data's book abbreviations, e.g. "Matt 1:18", "1 Ne 11:18", "Quran 19:20". Bible books:
  ${BOOKS.map((b) => b.abbr).join(", ")}. Restoration scripture: ${Object.keys(RESTORATION).join(", ")}.
- The "yaml" field must parse as YAML: quote any string that contains ": ", " #", or starts with a quote or bracket
  (e.g. source: '"Look! Jehovah''s Slave Girl!" (The Watchtower)').`;

export function formatGuide(t: Tradition) {
  const node = t.model.nodes.find((n) => n.attributes?.length) ?? t.model.nodes[0];
  const edge = t.model.edges[0];
  const ex = {
    add_node: { ...node, attributes: node.attributes?.slice(0, 1) },
    add_attribute: node.attributes?.[0],
    add_edge: edge,
    add_category: t.meta.categories.find((c) => c.parent),
    add_relationship: t.meta.relationships[0],
    add_axiom: t.meta.axioms[0],
    add_outline_topic: t.meta.topics[0],
    set_stance: t.meta.stances.find((s) => s.claims.length && s.citations),
    add_referent: { id: "ref.example", canonical: "Example Being", aliases: { [t.meta.tradition.id]: ["Its name in this tradition"] } },
    add_registry_topic: { id: "debate.example", kind: "debate", label: "A neutral proposition", known: "Its usual name" },
  };
  return `FORMAT GUIDE: each op's "yaml" is ONE element in exactly this shape (examples from the current data):\n${Object.entries(ex)
    .filter(([, v]) => v)
    .map(([op, v]) => `--- ${op}\n${stringify(v).trim()}`)
    .join("\n")}`;
}

export function judgePrompt(
  f: Focus,
  t: Tradition,
  r: ResearchOutput,
  checks: QuoteCheck[],
  rec: ReconcileOutput,
  critic: CriticOutput,
  criticChecks: QuoteCheck[],
  referents: Referent[],
) {
  const verified = [...checks, ...criticChecks].filter((c) => c.status === "verified").map((c) => ({ url: c.url, quote: c.quote }));
  return `${PROJECT}

You are the JUDGE. Weigh the blind research, the reconciliation against the existing model, and the critic's review, then
decide exactly what changes to make to ${t.meta.tradition.name}'s data, as structured ops.

${traditionBlock(t)}

${focusBlock(f, t, referents)}

FINDINGS:
${stringify(verifiedFindings(r, checks))}
RESEARCHER STANCE: ${stringify(r.stance ?? "n/a")}
RECONCILIATION:
${stringify(rec)}
CRITIQUE:
${stringify(critic)}
VERIFIED QUOTES (the only quotes you may use):
${stringify(verified)}

CURRENT METAMODEL:
${stringify(t.meta)}
CURRENT MODEL:
${stringify(t.model)}
REFERENTS: ${referents.map((x) => x.id).join(", ")}

${JUDGE_RULES}

${formatGuide(t)}`;
}

export function repairPrompt(original: string, ops: unknown, errors: string[]) {
  return `${original}

YOUR PREVIOUS OPS:
${stringify(ops)}

They were applied, but the project validator rejected the result:
${errors.map((e) => `- ${e}`).join("\n")}

Return the full corrected set of ops (same JSON shape). Fix the errors; do not add unrelated changes.`;
}

export type { Finding };
