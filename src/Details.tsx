import type React from "react";
import type { ReactNode } from "react";
import { categoryColor, type GroupColors } from "./graph";
import { categoryPath, describeAxiom, describeEdge, isA, versesCited } from "./ontology";
import { MATCH_LABEL, type CrosswalkLink } from "./crosswalk";
import { ScriptureList, type ScriptureCtx } from "./ScripturePanel";
import type { ClaimTarget } from "./validator/claim";
import { ValidateClaim } from "./validator/ValidatePanel";
import type { Axiom, Citations as CitationsT, Edge, OriginalEntry, Referent, RegistryTopic, ScriptureStore, Term, Tradition } from "./schema";
import { edgeTopicIds, KIND_LABEL, possessive, topicCoverage } from "./topics";
import type { Selection, Side } from "./selection";

export interface Ctx {
  side: Side;
  t: Tradition;
  other: Tradition;
  referents: Referent[];
  stores: Record<string, ScriptureStore>;
  original: Map<string, OriginalEntry>;
  otherVerses: Set<string>;
  /** Crosswalk links for the current pair, oriented left → right (empty in single mode). */
  crosswalks: CrosswalkLink[];
  /** Group colors in use for this pane (shared with the other pane when comparing). */
  colors: GroupColors;
  /** Shared topic registry (doctrines, salvation, life, debates). */
  topics: RegistryTopic[];
  onSelect: (s: Selection) => void;
  /** Pulses these graph elements while a claim is hovered in the panel (null clears). */
  onHover: (ids: string[] | null) => void;
}

/** Hovering a listed claim pulses it in the graph. */
const hoverProps = (ctx: Ctx, ids: string[]) => ({ onMouseEnter: () => ctx.onHover(ids), onMouseLeave: () => ctx.onHover(null) });

function Citations({ c, ctx }: { c: CitationsT; ctx: Ctx }) {
  const { meta } = ctx.t;
  const tierLabel = (id: string) => meta.tradition.tiers.find((x) => x.id === id)?.label ?? id;
  const tierRank = (id: string) => meta.tradition.tiers.findIndex((x) => x.id === id);
  const sctx = (storeId: string): ScriptureCtx => ({
    store: ctx.stores[storeId],
    label: ctx.stores[storeId]?.abbreviation ?? storeId,
    original: ctx.original,
    otherVerses: ctx.otherVerses,
    otherName: ctx.other.meta.tradition.shortName,
    onVerse: (id) => ctx.onSelect({ kind: "verse", id }),
  });
  const bible = sctx(meta.tradition.scripture.bible);
  const other = sctx(meta.tradition.scripture.other);
  const parallel = meta.tradition.bibleRole === "parallel";
  const bibleBlock = (
    <section className="cite-sec">
      <h5>
        {parallel ? "Bible parallel" : (meta.tradition.bibleLabel ?? "Bible")} <span>{bible.label}</span>
        {parallel && <em> · not scripture in this tradition</em>}
      </h5>
      {c.scripture.bible === "none-cited" ? (
        <p className="cite-none">{parallel ? "No parallel passage." : `No ${meta.tradition.bibleLabel ?? "Bible"} verse cited by the authority.`}</p>
      ) : (
        <div className={parallel ? "parallel" : undefined}>
          <ScriptureList items={c.scripture.bible} ctx={bible} />
        </div>
      )}
    </section>
  );
  const otherBlock = c.scripture.other?.length ? (
    <section className="cite-sec">
      <h5>
        {meta.tradition.otherScriptureLabel} <span>{other.label}</span>
      </h5>
      <ScriptureList items={c.scripture.other} ctx={other} />
    </section>
  ) : null;
  return (
    <div className="citations">
      {parallel ? (
        <>
          {otherBlock}
          {bibleBlock}
        </>
      ) : (
        <>
          {bibleBlock}
          {otherBlock}
        </>
      )}
      <section className="cite-sec">
        <h5>Authority</h5>
        {c.authority.map((a, i) => (
          <div key={i} className="authority">
            <div className="auth-line">
              <span className={`tier-dot tier-${tierRank(a.tier)}`} title={tierLabel(a.tier)} />
              <span className="source">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.source}
                  </a>
                ) : (
                  a.source
                )}
                {a.ref && <span className="muted"> · {a.ref}</span>}
              </span>
              <span className="tier-tag" title={tierLabel(a.tier)}>
                {tierLabel(a.tier).replace(/\s*\(.*\)\s*$/, "")}
              </span>
            </div>
            {a.quote && <blockquote>{a.quote}</blockquote>}
          </div>
        ))}
      </section>
    </div>
  );
}

function CategoryPath({ categoryId, ctx }: { categoryId: string; ctx: Ctx }) {
  return (
    <div className="crumbs">
      {categoryPath(ctx.t.meta, categoryId).map((c, i) => (
        <span key={c.id}>
          {i > 0 && <span className="sep">›</span>}
          <button
            className="crumb"
            style={{ "--dot": categoryColor(ctx.t.meta, c.id, ctx.colors) } as React.CSSProperties}
            title={`${c.definition}${c.term.kind === "editorial" ? " (editorial label)" : ""}`}
            onClick={() => ctx.onSelect({ side: ctx.side, kind: "category", id: c.id })}
          >
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}

const Validate = ({ ctx, target, compact }: { ctx: Ctx; target: ClaimTarget; compact?: boolean }) => (
  <ValidateClaim t={ctx.t} target={target} stores={ctx.stores} original={ctx.original} topics={ctx.topics} compact={compact} />
);

/** Chips for the tradition's own outline topics an element is filed under; clicking focuses that topic. */
function TopicChips({ ids, ctx }: { ids?: string[]; ctx: Ctx }) {
  const items = ctx.t.meta.topics.filter((x) => ids?.includes(x.id));
  if (!items.length) return null;
  return (
    <div className="topic-chips">
      <span className="meta-label">Topics</span>
      {items.map((it, i) => (
        <span key={it.id}>
          {i > 0 && <span className="dot-sep">·</span>}
          <button className="topic-chip" title={`${it.source.source}, ${it.source.ref ?? ""}`} onClick={() => ctx.onSelect({ kind: "topic", id: it.registry[0] })}>
            {it.label}
          </button>
        </span>
      ))}
    </div>
  );
}

const Link = ({ onClick, children, className = "" }: { onClick: () => void; children: ReactNode; className?: string }) => (
  <button className={`link ${className}`} onClick={onClick}>
    {children}
  </button>
);

/** "Source verb (as to X) Target" with each part clickable. */
function EdgeLine({ e, ctx }: { e: Edge; ctx: Ctx }) {
  const d = describeEdge(ctx.t, e);
  const sel = (kind: "node" | "edge" | "category", id: string) => () => ctx.onSelect({ side: ctx.side, kind, id });
  return (
    <>
      <Link onClick={sel("node", e.source)}>{d.source}</Link>{" "}
      <Link className="verb" onClick={sel("edge", e.id)}>
        {d.verb}
      </Link>{" "}
      {e.target ? (
        <Link onClick={sel("node", e.target)}>{d.target}</Link>
      ) : (
        <Link className="kind-ref" onClick={sel("category", e.targetKind!)}>
          {d.target}
        </Link>
      )}
      {d.asTo && (
        <>
          {" "}
          <span className="as-to">
            as to <Link onClick={sel("category", e.asTo!)}>{d.asTo}</Link>
          </span>
        </>
      )}
    </>
  );
}

function AxiomLine({ a, ctx }: { a: Axiom; ctx: Ctx }) {
  const d = describeAxiom(ctx.t.meta, a);
  const cat = (id: string) => () => ctx.onSelect({ side: ctx.side, kind: "category", id });
  return (
    <>
      <Link className="kind-ref" onClick={cat(a.source)}>
        {d.source}
      </Link>{" "}
      <Link className="verb" onClick={() => ctx.onSelect({ side: ctx.side, kind: "axiom", id: a.id })}>
        {d.verb}
      </Link>{" "}
      <Link className="kind-ref" onClick={cat(a.target)}>
        {d.target}
      </Link>
    </>
  );
}

function NodeDetail({ id, ctx, bridged }: { id: string; ctx: Ctx; bridged?: boolean }) {
  const { meta, model } = ctx.t;
  const n = model.nodes.find((x) => x.id === id);
  if (!n) return null;
  const ref = ctx.referents.find((r) => r.id === n.referent);
  const edges = model.edges.filter((e) => e.source === id || e.target === id);
  return (
    <div className="detail">
      {bridged && <div className="bridge-note">Same referent as your selection</div>}
      <h3>{n.label}</h3>
      <CategoryPath categoryId={n.category} ctx={ctx} />
      <TopicChips ids={[...new Set([...edges.flatMap((e) => edgeTopicIds(ctx.t, e.id)), ...(n.attributes ?? []).flatMap((a) => a.topics ?? [])])]} ctx={ctx} />
      {ref && (
        <div className="referent">
          <span className="meta-label">Referent</span>
          <button className="link" onClick={() => ctx.onSelect({ kind: "referent", id: ref.id })}>
            {ref.canonical}
          </button>
          {!!ref.aliases[meta.tradition.id]?.length && <span className="muted"> · also {ref.aliases[meta.tradition.id]!.join(", ")}</span>}
        </div>
      )}
      {n.description && <p>{n.description}</p>}
      <Citations c={n.citations} ctx={ctx} />
      <Validate ctx={ctx} target={{ kind: "node", id: n.id }} />
      {n.attributes?.map((a) => (
        <div key={a.name} className="attribute">
          <div>
            <strong>{a.name}:</strong> {a.value}
          </div>
          <TopicChips ids={a.topics} ctx={ctx} />
          <Citations c={a.citations} ctx={ctx} />
          <Validate ctx={ctx} target={{ kind: "attribute", id: n.id, name: a.name }} compact />
        </div>
      ))}
      {edges.length > 0 && (
        <>
          <h4>Relationships</h4>
          <ul className="rels">
            {edges.map((e) => (
              <li key={e.id} {...hoverProps(ctx, [e.id, e.source, ...(e.target ? [e.target] : [])])}>
                <EdgeLine e={e} ctx={ctx} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function EdgeDetail({ id, ctx }: { id: string; ctx: Ctx }) {
  const { meta, model } = ctx.t;
  const e = model.edges.find((x) => x.id === id);
  if (!e) return null;
  const rel = meta.relationships.find((r) => r.id === e.rel);
  return (
    <div className="detail">
      <h3>
        <EdgeLine e={e} ctx={ctx} />
      </h3>
      <TopicChips ids={edgeTopicIds(ctx.t, e.id)} ctx={ctx} />
      {e.targetKind && (
        <p className="muted small-note">
          {e.quantifier === "kind"
            ? "Refers to the kind itself (the universal), not to any member of it."
            : e.quantifier === "all"
              ? "Holds for every member of this kind."
              : "Refers to an unnamed member of this kind (existential). It is not tracked as a separate individual."}
        </p>
      )}
      {e.note && <p className="note">{e.note}</p>}
      <Citations c={e.citations} ctx={ctx} />
      <Validate ctx={ctx} target={{ kind: "edge", id: e.id }} />
      {rel && (
        <div className="attribute">
          <strong>Relationship type </strong>
          <Link className="verb" onClick={() => ctx.onSelect({ side: ctx.side, kind: "rel", id: rel.id })}>
            {rel.label}
          </Link>
          : {rel.definition}
        </div>
      )}
    </div>
  );
}

function AxiomDetail({ id, ctx }: { id: string; ctx: Ctx }) {
  const a = ctx.t.meta.axioms.find((x) => x.id === id);
  if (!a) return null;
  return (
    <div className="detail">
      <div className="bridge-note muted">Class-level statement (true of every member)</div>
      <h3>
        <AxiomLine a={a} ctx={ctx} />
      </h3>
      {a.note && <p className="note">{a.note}</p>}
      <Citations c={a.citations} ctx={ctx} />
      <Validate ctx={ctx} target={{ kind: "axiom", id: a.id }} />
    </div>
  );
}

/** Where a category's name comes from: the tradition's own term (with the quote that uses it) or an editorial label. */
function TermSource({ term }: { term: Term }) {
  if (term.kind === "editorial")
    return (
      <div className="term-source editorial">
        <span className="meta-label">Name</span> <strong>Editorial label</strong>
        <span className="muted"> · {term.note}</span>
      </div>
    );
  const where = term.url ? new URL(term.url).hostname.replace(/^www\./, "") : term.ref;
  return (
    <div className="term-source own">
      <span className="meta-label">Name</span> <strong>The tradition's own term</strong>
      <span className="muted">
        {" "}
        ·{" "}
        {term.url ? (
          <a href={term.url} target="_blank" rel="noreferrer">
            {where}
          </a>
        ) : (
          where
        )}
      </span>
      <blockquote>“{term.quote}”</blockquote>
    </div>
  );
}

function CategoryDetail({ id, ctx }: { id: string; ctx: Ctx }) {
  const { meta, model } = ctx.t;
  const c = meta.categories.find((x) => x.id === id);
  if (!c) return null;
  const children = meta.categories.filter((x) => x.parent === id);
  const instances = model.nodes.filter((n) => isA(meta, n.category, id));
  const axioms = meta.axioms.filter((a) => a.source === id || a.target === id);
  const refs = model.edges.filter((e) => e.targetKind === id || e.asTo === id);
  const list = (items: { id: string; label: string }[], kind: "category" | "node") =>
    items.map((x, i) => (
      <span key={x.id}>
        {i > 0 && ", "}
        <Link onClick={() => ctx.onSelect({ side: ctx.side, kind, id: x.id })}>{x.label}</Link>
      </span>
    ));
  return (
    <div className="detail">
      <div className="bridge-note muted">Category (kind)</div>
      <h3>{c.label}</h3>
      <CategoryPath categoryId={id} ctx={ctx} />
      <TermSource term={c.term} />
      <p>{c.definition}</p>
      <Citations c={c.citations} ctx={ctx} />
      <Validate ctx={ctx} target={{ kind: "category", id: c.id }} />
      <CrosswalkList categoryId={id} ctx={ctx} />
      {children.length > 0 && (
        <p>
          <strong>Subcategories: </strong>
          {list(children, "category")}
        </p>
      )}
      {instances.length > 0 && (
        <p>
          <strong>Individuals of this kind: </strong>
          {list(instances, "node")}
        </p>
      )}
      {axioms.length > 0 && (
        <>
          <h4>Class-level statements</h4>
          <ul className="rels">
            {axioms.map((a) => (
              <li key={a.id}>
                <AxiomLine a={a} ctx={ctx} />
              </li>
            ))}
          </ul>
        </>
      )}
      {refs.length > 0 && (
        <>
          <h4>Referenced by</h4>
          <ul className="rels">
            {refs.map((e) => (
              <li key={e.id}>
                <EdgeLine e={e} ctx={ctx} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RelDetail({ id, ctx }: { id: string; ctx: Ctx }) {
  const { meta, model } = ctx.t;
  const r = meta.relationships.find((x) => x.id === id);
  if (!r) return null;
  const cat = (cid: string) => meta.categories.find((c) => c.id === cid)?.label ?? cid;
  return (
    <div className="detail">
      <div className="bridge-note muted">Relationship type</div>
      <h3>
        <span className="verb">{r.label}</span>
      </h3>
      <p>{r.definition}</p>
      <p className="muted">
        {r.domain.map(cat).join(" | ")} → {r.range.map(cat).join(" | ")}
      </p>
      <Citations c={r.citations} ctx={ctx} />
      <ul className="rels">
        {meta.axioms
          .filter((a) => a.rel === id)
          .map((a) => (
            <li key={a.id}>
              <AxiomLine a={a} ctx={ctx} />
            </li>
          ))}
        {model.edges
          .filter((e) => e.rel === id)
          .map((e) => (
            <li key={e.id}>
              <EdgeLine e={e} ctx={ctx} />
            </li>
          ))}
      </ul>
    </div>
  );
}

function VerseDetail({ verse, ctx }: { verse: string; ctx: Ctx }) {
  const { model, meta } = ctx.t;
  const claims = versesCited(ctx.t).get(verse) ?? [];
  const store = ctx.stores[meta.tradition.scripture.bible];
  const original = ctx.original.get(verse);
  return (
    <div className="detail">
      <h3>
        {verse} <span className="muted small">({store?.abbreviation})</span>
      </h3>
      <blockquote className="verse-quote">{store?.verses[verse] ?? "Text not in this tradition's store."}</blockquote>
      {original && (
        <p className="muted small">
          {original.lang === "grc" ? "Greek" : "Hebrew"}:{" "}
          <span className={original.lang === "hbo" ? "heb" : "grk"}>{original.text}</span>
        </p>
      )}
      {claims.length === 0 ? (
        <p className="muted">Not cited by any claim in this slice.</p>
      ) : (
        <>
          <p className="muted">Cited as support for:</p>
          <ul className="rels">
            {claims.map((c, i) => {
              const e = c.kind === "edge" ? model.edges.find((x) => x.id === c.id) : undefined;
              const a = c.kind === "axiom" ? meta.axioms.find((x) => x.id === c.id) : undefined;
              const n = c.kind === "node" ? model.nodes.find((x) => x.id === c.id) : undefined;
              return (
                <li key={i}>
                  {e && <EdgeLine e={e} ctx={ctx} />}
                  {a && <AxiomLine a={a} ctx={ctx} />}
                  {n && (
                    <Link onClick={() => ctx.onSelect({ side: ctx.side, kind: "node", id: n.id })}>
                      {n.label}
                      {c.via && <span className="muted">: {c.via}</span>}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

const catLabel = (t: Tradition, id?: string) => t.meta.categories.find((c) => c.id === id)?.label ?? id ?? "";

/** Counterparts of a category in the other tradition (curated and derived). */
function CrosswalkList({ categoryId, ctx }: { categoryId: string; ctx: Ctx }) {
  const mine = (l: CrosswalkLink) => (ctx.side === "left" ? l.left : l.right);
  const theirs = (l: CrosswalkLink) => (ctx.side === "left" ? l.right : l.left);
  const links = ctx.crosswalks.filter((l) => mine(l) === categoryId);
  if (!links.length) return null;
  const refName = (id: string) => ctx.referents.find((r) => r.id === id)?.canonical ?? id;
  return (
    <>
      <h4>Crosswalk to {ctx.other.meta.tradition.shortName}</h4>
      <ul className="rels">
        {links.map((l) => (
          <li key={l.id}>
            <span className={`xw-badge xw-${l.curated ? l.match : "derived"}`}>{l.curated ? MATCH_LABEL[l.match] : "shared referents"}</span>{" "}
            <Link onClick={() => ctx.onSelect({ kind: "crosswalk", id: l.id })}>
              {theirs(l) ? catLabel(ctx.other, theirs(l)) : `nothing in ${ctx.other.meta.tradition.shortName}`}
            </Link>
            {l.referents.length > 0 && <span className="muted"> · {l.referents.map(refName).join(", ")}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

const BASIS_LABEL = {
  tradition: "One tradition addresses the other",
  scholarly: "Comparative scholarship",
  editorial: "Editorial reading of both sides' own definitions",
} as const;

/** Both categories of a crosswalk, each in its own tradition's words, with what they share and where they part. */
export function CrosswalkDetail({ link, left, right }: { link: CrosswalkLink; left: Ctx; right: Ctx }) {
  const cw = link.curated;
  const refName = (id: string) => left.referents.find((r) => r.id === id)?.canonical ?? id;
  return (
    <div className="detail crosswalk-detail">
      <div className="bridge-note muted">Crosswalk</div>
      <h3>
        {link.left ? catLabel(left.t, link.left) : <em className="muted">no {left.t.meta.tradition.shortName} counterpart</em>}{" "}
        <span className="xw-arrow">⟷</span>{" "}
        {link.right ? catLabel(right.t, link.right) : <em className="muted">no {right.t.meta.tradition.shortName} counterpart</em>}
      </h3>
      <div className="xw-meta">
        <span className={`xw-badge xw-${cw ? link.match : "derived"}`}>{cw ? MATCH_LABEL[link.match] : "derived from shared referents"}</span>
        {cw && <span className="muted small">{BASIS_LABEL[cw.basis]}</span>}
      </div>
      {cw && <p>{cw.note}</p>}
      {cw?.differsOn && (
        <div className="xw-differs">
          <strong>Where they part ways</strong>
          <p>{cw.differsOn}</p>
        </div>
      )}
      {link.referents.length > 0 && (
        <p>
          <strong>Shared referents: </strong>
          {link.referents.map((r, i) => (
            <span key={r}>
              {i > 0 && ", "}
              <Link onClick={() => left.onSelect({ kind: "referent", id: r })}>{refName(r)}</Link>
            </span>
          ))}
          <span className="muted">. {left.t.meta.tradition.shortName} places them in the first category, {right.t.meta.tradition.shortName} in the second.</span>
        </p>
      )}
      {cw && cw.sources.length > 0 && (
        <>
          <h4>Sources for this crosswalk</h4>
          {cw.sources.map((a, i) => (
            <div key={i} className="authority">
              <span className="source">
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.source}
                  </a>
                ) : (
                  a.source
                )}
                {a.ref && <span className="muted">, {a.ref}</span>}
              </span>
              {a.quote && <blockquote>{a.quote}</blockquote>}
            </div>
          ))}
        </>
      )}
      <div className="xw-sides">
        {link.left && (
          <div className="xw-side">
            <div className="xw-side-head">{left.t.meta.tradition.shortName}</div>
            <CategoryDetail id={link.left} ctx={left} />
          </div>
        )}
        {link.right && (
          <div className="xw-side">
            <div className="xw-side-head">{right.t.meta.tradition.shortName}</div>
            <CategoryDetail id={link.right} ctx={right} />
          </div>
        )}
      </div>
    </div>
  );
}

const STANCE_LABEL = { affirms: "Affirms", rejects: "Rejects", condemns: "Condemns as heresy", reframes: "Reframes", none: "No stated position" } as const;

/** One registry topic as this tradition treats it: its own outline items, its stance, and the modeled claims. */
function TopicDetail({ id, ctx }: { id: string; ctx: Ctx }) {
  const topic = ctx.topics.find((x) => x.id === id);
  if (!topic) return null;
  const name = ctx.t.meta.tradition.shortName;
  const cov = topicCoverage(ctx.t, id);
  const { model } = ctx.t;
  const nodeLabel = (nid: string) => model.nodes.find((n) => n.id === nid)?.label ?? nid;
  return (
    <div className="detail">
      <div className="bridge-note muted">{KIND_LABEL[topic.kind]}</div>
      <h3>{topic.label}</h3>
      {topic.known && <p className="muted small-note">Known as: {topic.known}</p>}
      {cov.stance && (
        <div className={`stance stance-${cov.stance.stance}`}>
          <div>
            <span className="stance-badge">{STANCE_LABEL[cov.stance.stance]}</span> <strong>{name}</strong>
          </div>
          <p>{cov.stance.summary}</p>
          {cov.stance.citations && <Citations c={cov.stance.citations} ctx={ctx} />}
          {cov.stance.citations && <Validate ctx={ctx} target={{ kind: "stance", id }} />}
        </div>
      )}
      {topic.kind === "debate" && !cov.stance && <p className="muted">No stance recorded for {name} yet.</p>}
      {cov.items.length > 0 && (
        <>
          <h4>In {possessive(name)} own outline</h4>
          <ul className="rels">
            {cov.items.map((it) => (
              <li key={it.id}>
                <strong>{it.label}</strong>{" "}
                <span className="muted">
                  ·{" "}
                  {it.source.url ? (
                    <a href={it.source.url} target="_blank" rel="noreferrer">
                      {it.source.source}
                      {it.source.ref ? `, ${it.source.ref}` : ""}
                    </a>
                  ) : (
                    `${it.source.source}${it.source.ref ? `, ${it.source.ref}` : ""}`
                  )}
                  {!it.inOutline && " · covered by the model, not a headline outline point"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {topic.kind !== "debate" && !cov.items.length && <p className="muted">Not a topic in {possessive(name)} outline.</p>}
      {(cov.edges.size > 0 || cov.attributes.length > 0 || cov.axioms.size > 0 || (topic.kind === "debate" && cov.categories.size > 0)) && (
        <>
          <h4>{topic.kind === "debate" ? `Where the ${name} model expresses this` : "Modeled claims"}</h4>
          <ul className="rels">
            {model.edges
              .filter((e) => cov.edges.has(e.id))
              .map((e) => (
                <li key={e.id} {...hoverProps(ctx, [e.id, e.source, ...(e.target ? [e.target] : [])])}>
                  <EdgeLine e={e} ctx={ctx} />
                </li>
              ))}
            {ctx.t.meta.axioms
              .filter((a) => cov.axioms.has(a.id))
              .map((a) => (
                <li key={a.id} {...hoverProps(ctx, [a.id, a.source, a.target])}>
                  <AxiomLine a={a} ctx={ctx} />
                </li>
              ))}
            {cov.attributes.map((a) => {
              const n = model.nodes.find((x) => x.id === a.node);
              const value = n?.attributes?.find((x) => x.name === a.name)?.value;
              return (
                <li key={`${a.node}:${a.name}`} {...hoverProps(ctx, [a.node])}>
                  <Link onClick={() => ctx.onSelect({ side: ctx.side, kind: "node", id: a.node })}>{nodeLabel(a.node)}</Link>
                  <span className="muted">: {a.name}</span>
                  {value && <span className="attr-value"> {value}</span>}
                </li>
              );
            })}
            {[...cov.categories]
              .filter((c) => topic.kind === "debate" && !model.edges.some((e) => cov.edges.has(e.id) && e.targetKind === c))
              .map((c) => (
                <li key={c} {...hoverProps(ctx, [c])}>
                  <Link className="kind-ref" onClick={() => ctx.onSelect({ side: ctx.side, kind: "category", id: c })}>
                    «{ctx.t.meta.categories.find((x) => x.id === c)?.label ?? c}»
                  </Link>
                  <span className="muted"> (category)</span>
                </li>
              ))}
          </ul>
        </>
      )}
      {cov.status === "outline" && <p className="gap-note">Named in {possessive(name)} outline, but not modeled yet.</p>}
      {topic.kind === "debate" && cov.stance && cov.status !== "modeled" && (
        <p className="gap-note">No modeled claim expresses this stance yet.</p>
      )}
    </div>
  );
}

export function Sources({ ctx, attribution }: { ctx: Ctx; attribution: string[] }) {
  const { scripture } = ctx.t.meta.tradition;
  const stores = [...new Set([scripture.bible, scripture.other])].map((id) => ctx.stores[id]).filter(Boolean);
  return (
    <details className="sources">
      <summary>Scripture sources &amp; licenses</summary>
      {stores.map((s) => (
        <p key={s.id}>
          <strong>{s.name}</strong> ({s.publisher}). {s.copyright}
        </p>
      ))}
      {attribution.map((a) => (
        <p key={a}>{a}</p>
      ))}
    </details>
  );
}

export function Details({ sel, ctx, referent }: { sel: Selection | null; ctx: Ctx; referent?: string }) {
  const name = ctx.t.meta.tradition.shortName;
  if (!sel) return <p className="muted placeholder">Click a node, relationship, or category in the {name} graph.</p>;
  if (sel.kind === "verse") return <VerseDetail verse={sel.id} ctx={ctx} />;
  if (sel.kind === "topic") return <TopicDetail id={sel.id} ctx={ctx} />;
  if (sel.side === ctx.side) {
    if (sel.kind === "node") return <NodeDetail id={sel.id} ctx={ctx} />;
    if (sel.kind === "edge") return <EdgeDetail id={sel.id} ctx={ctx} />;
    if (sel.kind === "category") return <CategoryDetail id={sel.id} ctx={ctx} />;
    if (sel.kind === "rel") return <RelDetail id={sel.id} ctx={ctx} />;
    if (sel.kind === "axiom") return <AxiomDetail id={sel.id} ctx={ctx} />;
  }
  const bridged = referent ? ctx.t.model.nodes.filter((n) => n.referent === referent) : [];
  if (bridged.length) return <>{bridged.map((n) => <NodeDetail key={n.id} id={n.id} ctx={ctx} bridged={sel.kind !== "referent"} />)}</>;
  return (
    <p className="muted placeholder">
      {referent ? `No ${name} individual is linked to this referent.` : `No shared referent. Compare with the ${name} metamodel.`}
    </p>
  );
}
