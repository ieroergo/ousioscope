import { useEffect, useMemo, useState } from "react";
import { dataset, errors } from "./data";
import { Details, Sources, type Ctx } from "./Details";
import { GraphPane } from "./GraphPane";
import { categoryColor, neighborhood, type View } from "./graph";
import { categoryPath, versesCited } from "./ontology";
import type { Tradition } from "./schema";
import { marksFor, selectedReferent, type Selection, type Side } from "./selection";

const HOPS = [
  { label: "1 hop", value: 1 },
  { label: "2 hops", value: 2 },
  { label: "All", value: 99 },
];

export function App() {
  if (!dataset || errors.length)
    return (
      <div className="errors">
        <h2>Ontology data failed validation</h2>
        <ul>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  return <Compare />;
}

function Compare() {
  const { traditions, referents, stores, original } = dataset!;
  const originalByRef = useMemo(() => new Map(original.entries.map((e) => [e.ref, e])), [original]);
  const byId = (id: string) => traditions.find((t) => t.meta.tradition.id === id)!;
  const params = new URLSearchParams(location.search);
  const known = (id: string | null, fallback: string) => (traditions.some((t) => t.meta.tradition.id === id) ? id! : fallback);
  const [ids, setIdsRaw] = useState<Record<Side, string>>(() => ({
    left: known(params.get("left"), "catholic"),
    right: known(params.get("right"), "lds"),
  }));
  const [view, setView] = useState<View>(() => (params.get("view") === "metamodel" ? "metamodel" : "model"));
  useEffect(() => {
    const q = new URLSearchParams({ left: ids.left, right: ids.right, ...(view === "metamodel" ? { view } : {}) });
    history.replaceState(null, "", `?${q}`);
  }, [ids, view]);
  const setIds = (next: Record<Side, string>) => {
    setIdsRaw(next);
    setSel(focus ? { kind: "referent", id: focus } : null);
  };
  const [focus, setFocus] = useState<string | null>("ref.jesus");
  const [hops, setHops] = useState(99);
  const [minTier, setMinTier] = useState<Record<Side, number>>({ left: 99, right: 99 });
  const [sel, setSelRaw] = useState<Selection | null>({ kind: "referent", id: "ref.jesus" });
  const [panelSide, setPanelSide] = useState<Side>("left");
  const [panelOpen, setPanelOpen] = useState(true);
  // Clicking in a pane shows that pane's tradition in the detail panel.
  const setSel = (s: Selection | null) => {
    setSelRaw(s);
    if (s?.side) setPanelSide(s.side);
    if (s) setPanelOpen(true);
  };
  const chooseReferent = (id: string | null) => {
    setFocus(id);
    setSel(id ? { kind: "referent", id } : null);
  };

  const trads: Record<Side, Tradition> = { left: byId(ids.left), right: byId(ids.right) };
  const verses = useMemo(
    () => ({ left: versesCited(trads.left), right: versesCited(trads.right) }),
    [trads.left, trads.right],
  );
  const referent = selectedReferent(sel, trads);
  const visible = useMemo(
    () => ({ left: neighborhood(trads.left, focus, hops), right: neighborhood(trads.right, focus, hops) }),
    [trads.left, trads.right, focus, hops],
  );

  const pane = (side: Side) => {
    const t = trads[side];
    const other: Side = side === "left" ? "right" : "left";
    return (
      <section className={`pane pane-${side}`}>
        <header className="pane-head">
          <div className="pane-pick">
            {side === "right" && (
              <button className="swap" title="Swap sides" onClick={() => setIds({ left: ids.right, right: ids.left })}>
                ⇄
              </button>
            )}
            <select
              className="tradition-select"
              value={ids[side]}
              title={t.meta.tradition.name}
              onChange={(e) => setIds({ ...ids, [side]: e.target.value })}
            >
              {traditions.map((x) => (
                <option key={x.meta.tradition.id} value={x.meta.tradition.id} disabled={x.meta.tradition.id === ids[other]}>
                  {x.meta.tradition.name}
                </option>
              ))}
            </select>
          </div>
          {view === "model" && (
            <label className="tier-filter" title="Fade claims whose strongest authority is below this tier">
              Min. tier
              <select
                value={Math.min(minTier[side], t.meta.tradition.tiers.length - 1)}
                onChange={(e) => setMinTier({ ...minTier, [side]: +e.target.value })}
              >
                {t.meta.tradition.tiers.map((tier, i) => (
                  <option key={tier.id} value={i}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <GraphPane
          side={side}
          tradition={t}
          view={view}
          visible={visible[side]}
          minTier={minTier[side]}
          marks={marksFor(side, t, sel, referent)}
          onSelect={setSel}
        />
        <Legend t={t} />
      </section>
    );
  };

  const ctx = (side: Side): Ctx => {
    const other: Side = side === "left" ? "right" : "left";
    return {
      side,
      t: trads[side],
      other: trads[other],
      referents,
      stores,
      original: originalByRef,
      otherVerses: new Set(verses[other].keys()),
      onSelect: setSel,
    };
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand" title="From Greek ousia (οὐσία), “being, substance”">
          <span className="brand-mark" aria-hidden />
          <h1>Ousioscope</h1>
          <span className="brand-tag">what each tradition says things are</span>
        </div>
        <label className="referent-pick" title="Highlights this referent in both traditions and focuses the graphs on it">
          Referent
          <select value={focus ?? ""} onChange={(e) => chooseReferent(e.target.value || null)}>
            <option value="">— Everything —</option>
            {referents.map((r) => {
              const missing = (["left", "right"] as Side[])
                .filter((s) => !trads[s].model.nodes.some((n) => n.referent === r.id))
                .map((s) => trads[s].meta.tradition.shortName);
              return (
                <option key={r.id} value={r.id}>
                  {r.canonical}
                  {missing.length ? ` (none in ${missing.join(", ")})` : ""}
                </option>
              );
            })}
          </select>
        </label>
        {view === "model" && focus && (
          <div className="segmented" title="How far from the referent to show">
            {HOPS.map((h) => (
              <button key={h.value} className={hops === h.value ? "on" : ""} onClick={() => setHops(h.value)}>
                {h.label}
              </button>
            ))}
          </div>
        )}
        <div className="controls">
          <div className="segmented">
            {(["model", "metamodel"] as View[]).map((v) => (
              <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {v === "model" ? "Model (claims)" : "Metamodel (categories)"}
              </button>
            ))}
          </div>
          <button className="panel-toggle" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>
            {panelOpen ? "Hide details ▸" : "◂ Details"}
          </button>
        </div>
      </header>

      <main className={`compare ${panelOpen ? "with-panel" : ""}`}>
        {pane("left")}
        {pane("right")}
        {panelOpen && (
          <aside className="side-panel">
            <div className="panel-tabs" role="tablist">
              {(["left", "right"] as Side[]).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={panelSide === s}
                  className={panelSide === s ? "on" : ""}
                  onClick={() => setPanelSide(s)}
                >
                  {s === "left" ? "◧ " : ""}
                  {trads[s].meta.tradition.shortName}
                  {s === "right" ? " ◨" : ""}
                </button>
              ))}
              <button className="panel-close" title="Hide details" onClick={() => setPanelOpen(false)}>
                ×
              </button>
            </div>
            <div className="panel-body">
              <Details sel={sel} ctx={ctx(panelSide)} referent={referent} />
              <Sources ctx={ctx(panelSide)} attribution={original.attribution} />
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function Legend({ t }: { t: Tradition }) {
  const groups = t.meta.categories.filter((c) => c.group);
  return (
    <div className="legend">
      {groups.map((g) => (
        <span key={g.id} title={g.definition}>
          <i style={{ background: categoryColor(t.meta, g.id) }} />
          {categoryPath(t.meta, g.id)
            .map((c) => c.label)
            .join(" › ")}
        </span>
      ))}
      <span>
        <i className="ref-swatch" /> individual (referent)
      </span>
      <span>
        <i className="kind-swatch" /> «kind» (some member of a category)
      </span>
    </div>
  );
}
