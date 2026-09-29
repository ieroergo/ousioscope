import type { Core } from "cytoscape";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { crosswalkLinks } from "./crosswalk";
import { CrosswalkOverlay } from "./CrosswalkOverlay";
import { dataset, errors } from "./data";
import { CrosswalkDetail, Details, Sources, type Ctx } from "./Details";
import { GraphPane } from "./GraphPane";
import { categoryColor, neighborhood, type Grouping, type View } from "./graph";
import { categoryPath, versesCited } from "./ontology";
import type { Tradition } from "./schema";
import { marksFor, selectedReferent, type Selection, type Side } from "./selection";
import { focusTopics, KIND_LABEL, statusGlyph, topicCoverage, type FocusKind, type TopicCoverage } from "./topics";
import { ValidatorProvider } from "./validator/state";

type Mode = "single" | "compare";

const PANEL_KEY = "ousioscope.panelWidth";
const clampPanel = (w: number) => Math.round(Math.min(Math.max(w, 300), window.innerWidth * 0.7));

/** Detail-panel width in px, resizable by dragging its left edge; remembered across visits. */
function usePanelWidth(): [number, (e: PointerEvent<HTMLDivElement>) => void] {
  const [width, setWidth] = useState(() => clampPanel(Number(localStorage.getItem(PANEL_KEY)) || window.innerWidth * 0.3));
  useEffect(() => localStorage.setItem(PANEL_KEY, String(width)), [width]);
  const start = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const right = handle.parentElement!.getBoundingClientRect().right;
    document.body.classList.add("resizing");
    const move = (ev: globalThis.PointerEvent) => setWidth(clampPanel(right - ev.clientX));
    const stop = () => {
      document.body.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }, []);
  return [width, start];
}

const GROUPINGS: { value: Grouping; label: string; title: string }[] = [
  { value: "containers", label: "Boxes", title: "Grouping: top-level categories drawn as boxes around their members" },
  { value: "nodes", label: "Nodes", title: "Grouping: each category is its own node, linked by 'is a' edges, so it can be selected and compared" },
  { value: "color", label: "Color", title: "Grouping: category shown by color only" },
];

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
  return (
    <ValidatorProvider>
      <Compare />
    </ValidatorProvider>
  );
}

function Compare() {
  const { traditions, referents, stores, original, crosswalks, topics } = dataset!;
  const originalByRef = useMemo(() => new Map(original.entries.map((e) => [e.ref, e])), [original]);
  const byId = (id: string) => traditions.find((t) => t.meta.tradition.id === id)!;
  const params = new URLSearchParams(location.search);
  const known = (id: string | null, fallback: string) => (traditions.some((t) => t.meta.tradition.id === id) ? id! : fallback);
  const [ids, setIdsRaw] = useState<Record<Side, string>>(() => ({
    left: known(params.get("left"), "catholic"),
    right: known(params.get("right"), "lds"),
  }));
  const [focus, setFocus] = useState<string | null>(() => params.get("topic") ?? "ref.jesus");
  const [view, setView] = useState<View>(() => (params.get("view") === "metamodel" ? "metamodel" : "model"));
  const [mode, setMode] = useState<Mode>(() => (params.get("mode") === "single" ? "single" : "compare"));
  const single = mode === "single";
  const [grouping, setGrouping] = useState<Grouping>(() => {
    const g = params.get("group");
    return g === "nodes" || g === "color" ? g : "containers";
  });
  const [crosswalkOn, setCrosswalkOn] = useState(() => params.get("xw") === "1");
  useEffect(() => {
    const q = new URLSearchParams({
      left: ids.left,
      ...(single ? { mode } : { right: ids.right }),
      ...(view === "metamodel" ? { view } : {}),
      ...(grouping !== "containers" ? { group: grouping } : {}),
      ...(crosswalkOn && !single ? { xw: "1" } : {}),
      ...(focus && focus !== "ref.jesus" ? { topic: focus } : {}),
    });
    history.replaceState(null, "", `?${q}`);
  }, [ids, view, mode, single, grouping, crosswalkOn, focus]);
  const [cys, setCys] = useState<Record<Side, Core | null>>({ left: null, right: null });
  const onInstance = useCallback((side: Side, cy: Core | null) => setCys((prev) => ({ ...prev, [side]: cy })), []);
  const setIds = (next: Record<Side, string>) => {
    setIdsRaw(next);
    setSel(focus ? focusSelection(focus) : null);
  };
  const [hops, setHops] = useState(99);
  const [minTier, setMinTier] = useState<Record<Side, number>>({ left: 99, right: 99 });
  const focusList = useMemo(() => focusTopics(referents, topics), [referents, topics]);
  const focusTopic = focusList.find((f) => f.id === focus);
  const focusSelection = (id: string): Selection => (id.startsWith("ref.") ? { kind: "referent", id } : { kind: "topic", id });
  const [sel, setSelRaw] = useState<Selection | null>(() => focusSelection(params.get("topic") ?? "ref.jesus"));
  const [panelSideRaw, setPanelSide] = useState<Side>("left");
  const panelSide: Side = single ? "left" : panelSideRaw;
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, startResize] = usePanelWidth();
  // Clicking in a pane shows that pane's tradition in the detail panel.
  // Selecting a subject or topic anywhere (picker, chip, link) also focuses the graphs on it.
  const setSel = (s: Selection | null) => {
    setSelRaw(s);
    if (s?.side) setPanelSide(s.side);
    if (s?.kind === "referent" || s?.kind === "topic") setFocus(s.id);
    if (s) setPanelOpen(true);
  };
  const chooseFocus = (id: string | null) => {
    setFocus(id);
    setSel(id ? focusSelection(id) : null);
  };

  const trads: Record<Side, Tradition> = { left: byId(ids.left), right: byId(ids.right) };
  const verses = useMemo(
    () => ({ left: versesCited(trads.left), right: versesCited(trads.right) }),
    [trads.left, trads.right],
  );
  const referent = selectedReferent(sel, trads);
  const links = useMemo(
    () => (single ? [] : crosswalkLinks(trads.left, trads.right, crosswalks, referents)),
    [single, trads.left, trads.right, crosswalks, referents],
  );
  const selectedLink = sel?.kind === "crosswalk" ? links.find((l) => l.id === sel.id) : undefined;
  const marks = (side: Side, t: Tradition) => {
    if (sel?.kind === "topic" && coverage) return topicMarks(coverage[side]);
    if (!selectedLink) return marksFor(side, t, sel, referent);
    const cat = side === "left" ? selectedLink.left : selectedLink.right;
    return new Map(cat ? [[cat, "selected" as const]] : []);
  };
  const topicFocus = focusTopic && focusTopic.kind !== "subject" ? focusTopic : undefined;
  const coverage = useMemo(
    () => (topicFocus ? { left: topicCoverage(trads.left, topicFocus.id), right: topicCoverage(trads.right, topicFocus.id) } : undefined),
    [topicFocus, trads.left, trads.right],
  );
  const visible = useMemo(() => {
    const all = (t: Tradition) => new Set(t.model.nodes.map((n) => n.id));
    // A topic shows exactly the claims filed under it; if nothing is modeled, the whole graph stays visible (dimmed).
    const forTopic = (t: Tradition, c: TopicCoverage) => (c.nodes.size ? c.nodes : all(t));
    return coverage
      ? { left: forTopic(trads.left, coverage.left), right: forTopic(trads.right, coverage.right) }
      : { left: neighborhood(trads.left, focus, hops), right: neighborhood(trads.right, focus, hops) };
  }, [trads.left, trads.right, focus, hops, coverage]);
  const topicMarks = (c: TopicCoverage) => {
    const m = new Map<string, "hit">();
    [...c.nodes, ...c.edges, ...c.axioms].forEach((id) => m.set(id, "hit"));
    return m;
  };

  const pane = (side: Side) => {
    const t = trads[side];
    const other: Side = side === "left" ? "right" : "left";
    return (
      <section className={`pane pane-${side}`}>
        <header className="pane-head">
          <div className="pane-pick">
            {side === "right" && !single && (
              <button className="swap" title="Swap sides" onClick={() => setIds({ left: ids.right, right: ids.left })}>
                ⇄
              </button>
            )}
            <select
              className="tradition-select"
              value={ids[side]}
              title={t.meta.tradition.name}
              onChange={(e) => {
                const next = { ...ids, [side]: e.target.value };
                // In single mode any tradition may be picked; keep the hidden side distinct for later comparison.
                if (single && next.left === next.right) next.right = ids.left;
                setIds(next);
              }}
            >
              {traditions.map((x) => (
                <option
                  key={x.meta.tradition.id}
                  value={x.meta.tradition.id}
                  disabled={!single && x.meta.tradition.id === ids[other]}
                >
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
          grouping={grouping}
          visible={visible[side]}
          minTier={minTier[side]}
          marks={marks(side, t)}
          onSelect={setSel}
          onInstance={onInstance}
          edgeFilter={coverage && coverage[side].nodes.size ? coverage[side].edges : undefined}
        />
        {coverage && coverage[side].status !== "modeled" && topicFocus && (
          <div className="pane-note">
            <strong>{topicFocus.label}</strong>
            {coverage[side].status === "outline" ? (
              <span>
                In {t.meta.tradition.shortName}'s outline ({coverage[side].items.map((i) => i.label).join("; ")}), not yet modeled.
              </span>
            ) : topicFocus.kind === "debate" ? (
              <span>No stance recorded for {t.meta.tradition.shortName}.</span>
            ) : (
              <span>Not in {t.meta.tradition.shortName}'s outline or model.</span>
            )}
          </div>
        )}
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
      otherVerses: single ? new Set<string>() : new Set(verses[other].keys()),
      crosswalks: links,
      topics,
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
        <label className="referent-pick" title="Focus both traditions on a subject, doctrine, matter of salvation, or point of debate">
          Topic
          <select value={focus ?? ""} onChange={(e) => chooseFocus(e.target.value || null)}>
            <option value="">— Everything —</option>
            {(Object.keys(KIND_LABEL) as FocusKind[]).map((kind) => (
              <optgroup key={kind} label={KIND_LABEL[kind]}>
                {focusList
                  .filter((f) => f.kind === kind)
                  .map((f) => {
                    const sides = single ? (["left"] as Side[]) : (["left", "right"] as Side[]);
                    const glyphs = sides
                      .map((sd) =>
                        f.kind === "subject"
                          ? trads[sd].model.nodes.some((n) => n.referent === f.id)
                            ? "●"
                            : "○"
                          : statusGlyph(topicCoverage(trads[sd], f.id), f.kind),
                      )
                      .join(" ");
                    return (
                      <option key={f.id} value={f.id}>
                        {glyphs}  {f.label}
                      </option>
                    );
                  })}
              </optgroup>
            ))}
          </select>
        </label>
        {view === "model" && focus && focusTopic?.kind === "subject" && (
          <div className="segmented" title="How far from the subject to show">
            {HOPS.map((h) => (
              <button key={h.value} className={hops === h.value ? "on" : ""} onClick={() => setHops(h.value)}>
                {h.label}
              </button>
            ))}
          </div>
        )}
        <div className="controls">
          <div className="segmented" title="Show one tradition, or two side by side">
            {(["single", "compare"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {m === "single" ? "Single" : "Compare"}
              </button>
            ))}
          </div>
          <div className="segmented">
            {(["model", "metamodel"] as View[]).map((v) => (
              <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {v === "model" ? "Model" : "Metamodel"}
              </button>
            ))}
          </div>
          {view === "model" && (
            <div className="segmented labeled" title="How category membership is drawn">
              <span className="seg-label">Categories as</span>
              {GROUPINGS.map((g) => (
                <button key={g.value} className={grouping === g.value ? "on" : ""} title={g.title} onClick={() => setGrouping(g.value)}>
                  {g.label}
                </button>
              ))}
            </div>
          )}
          {!single && (
            <button
              className={`toggle-btn ${crosswalkOn ? "on" : ""}`}
              aria-pressed={crosswalkOn}
              title="Draw links between corresponding categories of the two traditions"
              onClick={() => setCrosswalkOn(!crosswalkOn)}
            >
              ⟷ Crosswalk
            </button>
          )}
          <button className="panel-toggle" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>
            {panelOpen ? "Hide details ▸" : "◂ Details"}
          </button>
        </div>
      </header>

      <main
        className={`compare ${single ? "single" : ""} ${panelOpen ? "with-panel" : ""}`}
        style={{ "--panel-w": `${panelWidth}px` } as CSSProperties}
      >
        {pane("left")}
        {!single && pane("right")}
        {crosswalkOn && !single && (
          <CrosswalkOverlay
            links={links}
            cys={cys}
            metas={{ left: trads.left.meta, right: trads.right.meta }}
            view={view}
            grouping={grouping}
            selectedId={selectedLink?.id}
            onSelect={(id) => setSel({ kind: "crosswalk", id })}
          />
        )}
        {panelOpen && (
          <aside className="side-panel">
            <div
              className="panel-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize details panel"
              title="Drag to resize"
              onPointerDown={startResize}
            />
            <div className="panel-tabs" role="tablist">
              {(single ? (["left"] as Side[]) : (["left", "right"] as Side[])).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={panelSide === s}
                  className={panelSide === s ? "on" : ""}
                  onClick={() => setPanelSide(s)}
                >
                  {!single && s === "left" ? "◧ " : ""}
                  {trads[s].meta.tradition.shortName}
                  {!single && s === "right" ? " ◨" : ""}
                </button>
              ))}
              <button className="panel-close" title="Hide details" onClick={() => setPanelOpen(false)}>
                ×
              </button>
            </div>
            <div className="panel-body">
              {selectedLink ? (
                <CrosswalkDetail link={selectedLink} left={ctx("left")} right={ctx("right")} />
              ) : (
                <Details sel={sel} ctx={ctx(panelSide)} referent={referent} />
              )}
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
