import type { ReactNode } from "react";
import { categoryColor } from "./graph";
import { categoryPath, describeAxiom, describeEdge, isA, versesCited } from "./ontology";
import { ScriptureList, type ScriptureCtx } from "./ScripturePanel";
import type { Axiom, Citations as CitationsT, Edge, OriginalEntry, Referent, ScriptureStore, Tradition } from "./schema";
import type { Selection, Side } from "./selection";

export interface Ctx {
  side: Side;
  t: Tradition;
  other: Tradition;
  referents: Referent[];
  stores: Record<string, ScriptureStore>;
  original: Map<string, OriginalEntry>;
  otherVerses: Set<string>;
  onSelect: (s: Selection) => void;
}

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
    <>
      <div className="cite-kind">
        {parallel ? "Bible parallel (not scripture in this tradition)" : "Bible"} · {bible.label}
      </div>
      {c.scripture.bible === "none-cited" ? (
        <em className="muted small">{parallel ? "No parallel Bible passage" : "No Bible verse cited by the authority"}</em>
      ) : (
        <div className={parallel ? "parallel" : undefined}>
          <ScriptureList items={c.scripture.bible} ctx={bible} />
        </div>
      )}
    </>
  );
  const otherBlock = c.scripture.other?.length ? (
    <>
      <div className="cite-kind">
        {meta.tradition.otherScriptureLabel} · {other.label}
      </div>
      <ScriptureList items={c.scripture.other} ctx={other} />
    </>
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
      <div className="cite-kind">Authority</div>
      {c.authority.map((a, i) => (
        <div key={i} className="authority">
          <span className={`tier tier-${tierRank(a.tier)}`}>{tierLabel(a.tier)}</span>
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
            style={{ borderColor: categoryColor(ctx.t.meta, c.id) }}
            title={c.definition}
            onClick={() => ctx.onSelect({ side: ctx.side, kind: "category", id: c.id })}
          >
            {c.label}
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
      {ref && (
        <div className="referent">
          <button className="chip ref-chip" onClick={() => ctx.onSelect({ kind: "referent", id: ref.id })}>
            Referent: {ref.canonical}
          </button>
          <span className="muted"> also called {ref.aliases[meta.tradition.id]?.join(", ")}</span>
        </div>
      )}
      {n.description && <p>{n.description}</p>}
      <Citations c={n.citations} ctx={ctx} />
      {n.attributes?.map((a) => (
        <div key={a.name} className="attribute">
          <div>
            <strong>{a.name}:</strong> {a.value}
          </div>
          <Citations c={a.citations} ctx={ctx} />
        </div>
      ))}
      {edges.length > 0 && (
        <>
          <h4>Relationships</h4>
          <ul className="rels">
            {edges.map((e) => (
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
      <p>{c.definition}</p>
      <Citations c={c.citations} ctx={ctx} />
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
