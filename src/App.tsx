import type { Core } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { crosswalkLinks } from "./crosswalk";
import { CrosswalkOverlay } from "./CrosswalkOverlay";
import { dataset, errors } from "./data";
import { CrosswalkDetail, Details, Sources, type Ctx } from "./Details";
import { GraphPane } from "./GraphPane";
import { categoryColor, maxDegree, neighborhood, type Grouping, type View } from "./graph";
import { categoryPath, versesCited } from "./ontology";
import type { Tradition } from "./schema";
import { marksFor, selectedReferent, type Selection, type Side } from "./selection";
import { focusTopics, KIND_LABEL, possessive, spotlightIds, topicCoverage, type FocusKind } from "./topics";
import { ValidatorProvider } from "./validator/state";

type Mode = "single" | "compare";
type FocusMode = "isolate" | "context";

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

const MAX_DEGREE = 99;

/**
 * Degrees of relationship from the focused subject: 1..5 steps, then "Max". The top of the range adapts to how far
 * this tradition's graph actually reaches (if it reaches 3 degrees, the range is 1, 2, Max).
 */
function DegreeSlider({ max, value, onChange }: { max: number; value: number; onChange: (v: number) => void }) {
  if (max < 1) return null;
  const steps = Math.min(max, 5) + (max > 5 ? 1 : 0);
  const toStep = (v: number) => (v >= max || v === MAX_DEGREE ? steps : Math.min(v, steps));
  const fromStep = (k: number) => (k === steps ? MAX_DEGREE : k);
  const step = toStep(value);
  const label = step === steps ? `Max (${max}°)` : `${step}°`;
  return (
    <label className="degree-slider" title="Degrees of relationship from the focused subject">
      <span>Degrees</span>
      <input type="range" min={1} max={steps} step={1} value={step} disabled={steps === 1} onChange={(e) => onChange(fromStep(+e.target.value))} />
      <output>{label}</output>
    </label>
  );
}

/** Gear button with a small popover for per-pane settings; a dot marks non-default settings. */
function PaneSettings({ active, label, children }: { active: boolean; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="pane-settings" ref={ref}>
      <button className={`gear ${open ? "on" : ""}`} title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
          <path
            fill="currentColor"
            d="M11.3 1.5l.4 2.2c.5.2 1 .5 1.4.8l2.1-.8 1.3 2.3-1.7 1.4c.1.5.1 1.1 0 1.6l1.7 1.4-1.3 2.3-2.1-.8c-.4.3-.9.6-1.4.8l-.4 2.2H8.7l-.4-2.2c-.5-.2-1-.5-1.4-.8l-2.1.8-1.3-2.3 1.7-1.4a4.8 4.8 0 010-1.6L3.5 6l1.3-2.3 2.1.8c.4-.3.9-.6 1.4-.8l.4-2.2h2.6zM10 7a3 3 0 100 6 3 3 0 000-6z"
          />
        </svg>
        {active && <span className="gear-dot" />}
      </button>
      {open && <div className="settings-pop">{children}</div>}
    </div>
  );
}

const Icon = ({ d, children }: { d?: string; children?: ReactNode }) => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);
const ICONS = {
  isolate: (
    <Icon>
      <circle cx="10" cy="10" r="3.2" fill="currentColor" />
      <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2" />
    </Icon>
  ),
  context: (
    <Icon>
      <circle cx="10" cy="10" r="2.6" fill="currentColor" />
      <circle cx="4" cy="5" r="1.4" opacity=".45" />
      <circle cx="16" cy="5.5" r="1.4" opacity=".45" />
      <circle cx="5" cy="15.5" r="1.4" opacity=".45" />
      <circle cx="15.5" cy="15" r="1.4" opacity=".45" />
    </Icon>
  ),
  single: <Icon d="M4 4.5h12v11H4z" />,
  compare: <Icon d="M2.5 4.5h6.5v11H2.5zM11 4.5h6.5v11H11z" />,
  model: (
    <Icon>
      <circle cx="5" cy="6" r="2" />
      <circle cx="15" cy="5" r="2" />
      <circle cx="10" cy="15" r="2" />
      <path d="M7 6l6-.8M6.1 7.7l2.8 5.6M14 6.9l-3 6.3" />
    </Icon>
  ),
  metamodel: <Icon d="M10 3v4M10 7H5v4M10 7h5v4M3 11h4v5H3zM13 11h4v5h-4zM8 2h4v3H8z" />,
  boxes: (
    <Icon>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" strokeDasharray="2.4 2" />
      <circle cx="7" cy="10" r="1.8" />
      <circle cx="13" cy="10" r="1.8" />
    </Icon>
  ),
  nodes: <Icon d="M10 3.5a2 2 0 110 .01M5 15.5a2 2 0 110 .01M15 15.5a2 2 0 110 .01M9 5.5L6 13.6M11 5.5l3 8.1" />,
  color: (
    <Icon>
      <circle cx="6.5" cy="7" r="2.6" fill="#e0954a" stroke="none" />
      <circle cx="13.5" cy="7" r="2.6" fill="#5b8def" stroke="none" />
      <circle cx="10" cy="13.5" r="2.6" fill="#3fa99a" stroke="none" />
    </Icon>
  ),
  crosswalk: <Icon d="M3 4v12M17 4v12M6 7.5h8M11.5 5l2.5 2.5-2.5 2.5M14 12.5H6M8.5 10L6 12.5 8.5 15" />,
};

interface ModeOption<T> {
  value: T;
  label: string;
  def: string;
  icon: ReactNode;
}

/** Icon-only segmented switch; hovering (or focusing) a button shows its name and definition. */
function ModeSwitch<T extends string>({ name, options, value, onChange }: { name: string; options: ModeOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented icon-seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} aria-label={`${o.label}: ${o.def}`} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.icon}
          <span className="tip" role="tooltip">
            <strong>
              {name}: {o.label}
            </strong>
            {o.def}
          </span>
        </button>
      ))}
    </div>
  );
}

const FOCUS_MODES: ModeOption<FocusMode>[] = [
  { value: "isolate", label: "Isolate", def: "Show only the claims under the current subject or topic.", icon: ICONS.isolate },
  { value: "context", label: "In context", def: "Show the whole graph and dim everything outside the current subject or topic.", icon: ICONS.context },
];
const LAYOUT_MODES: ModeOption<Mode>[] = [
  { value: "single", label: "Single", def: "One tradition fills the canvas.", icon: ICONS.single },
  { value: "compare", label: "Compare", def: "Two traditions side by side, each on its own canvas.", icon: ICONS.compare },
];
const VIEWS: ModeOption<View>[] = [
  { value: "model", label: "Model", def: "The claims: named beings and the relationships a tradition asserts between them.", icon: ICONS.model },
  { value: "metamodel", label: "Metamodel", def: "The categories: a tradition's kinds of being, how they nest, and which relationships connect them.", icon: ICONS.metamodel },
];
const GROUPINGS: ModeOption<Grouping>[] = [
  { value: "containers", label: "Boxes", def: "Top-level categories are drawn as boxes around their members.", icon: ICONS.boxes },
  { value: "nodes", label: "Nodes", def: "Each category is its own node, linked by 'is a' edges, so it can be selected and compared.", icon: ICONS.nodes },
  { value: "color", label: "Color", def: "Category is shown by color only; the cleanest graph of claims.", icon: ICONS.color },
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
  const [focusMode, setFocusMode] = useState<FocusMode>(() => (params.get("fm") === "context" ? "context" : "isolate"));
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
      ...(focusMode === "context" ? { fm: "context" } : {}),
    });
    history.replaceState(null, "", `?${q}`);
  }, [ids, view, mode, single, grouping, crosswalkOn, focus, focusMode]);
  const [cys, setCys] = useState<Record<Side, Core | null>>({ left: null, right: null });
  const onInstance = useCallback((side: Side, cy: Core | null) => setCys((prev) => ({ ...prev, [side]: cy })), []);
  const setIds = (next: Record<Side, string>) => {
    setIdsRaw(next);
    setSel(focus ? focusSelection(focus) : null);
  };
  /** Degrees of relationship shown around a focused subject, per canvas (MAX_DEGREE = everything reachable). */
  const [degrees, setDegrees] = useState<Record<Side, number>>({ left: MAX_DEGREE, right: MAX_DEGREE });
  const [layoutKey, setLayoutKey] = useState<Record<Side, number>>({ left: 0, right: 0 });
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
    if (!selectedLink) return marksFor(side, t, sel, referent);
    const cat = side === "left" ? selectedLink.left : selectedLink.right;
    return new Map(cat ? [[cat, "selected" as const]] : []);
  };
  const topicFocus = focusTopic && focusTopic.kind !== "subject" ? focusTopic : undefined;
  const coverage = useMemo(
    () => (topicFocus ? { left: topicCoverage(trads.left, topicFocus.id), right: topicCoverage(trads.right, topicFocus.id) } : undefined),
    [topicFocus, trads.left, trads.right],
  );
  /** What the focus covers on each side: a topic's coverage, or a subject's neighborhood (nodes + edges among them). */
  const focusCoverage = useMemo(() => {
    if (!focus) return undefined;
    if (coverage) return coverage;
    const around = (t: Tradition, side: Side) => {
      const nodes = neighborhood(t, focus, degrees[side]);
      const edges = t.model.edges.filter((e) => nodes.has(e.source) && (!e.target || nodes.has(e.target)));
      return {
        nodes,
        edges: new Set(edges.map((e) => e.id)),
        categories: new Set(edges.flatMap((e) => (e.targetKind ? [e.targetKind] : []))),
        axioms: new Set<string>(),
      };
    };
    return { left: around(trads.left, "left"), right: around(trads.right, "right") };
  }, [focus, coverage, degrees, trads.left, trads.right]);
  const allNodes = (t: Tradition) => new Set(t.model.nodes.map((n) => n.id));
  // Isolate shows only the focus (empty if nothing is modeled); In context shows everything and dims the rest.
  const isolate = focusMode === "isolate";
  const visible = useMemo(
    () => ({
      left: focusCoverage && isolate ? focusCoverage.left.nodes : allNodes(trads.left),
      right: focusCoverage && isolate ? focusCoverage.right.nodes : allNodes(trads.right),
    }),
    [focusCoverage, isolate, trads.left, trads.right],
  );
  const spotlight = useMemo(
    () =>
      focusCoverage && !isolate
        ? { left: spotlightIds(trads.left, focusCoverage.left, view), right: spotlightIds(trads.right, focusCoverage.right, view) }
        : undefined,
    [focusCoverage, isolate, trads.left, trads.right, view],
  );
  const metaKeep = useMemo(
    () =>
      focusCoverage && isolate && view === "metamodel"
        ? { left: spotlightIds(trads.left, focusCoverage.left, "metamodel"), right: spotlightIds(trads.right, focusCoverage.right, "metamodel") }
        : undefined,
    [focusCoverage, isolate, trads.left, trads.right, view],
  );
  const [hover, setHover] = useState<{ side: Side; ids: string[] } | null>(null);

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
          {view === "model" && focusTopic?.kind === "subject" && (
            <DegreeSlider
              max={maxDegree(t, focusTopic.id)}
              value={degrees[side]}
              onChange={(v) => setDegrees({ ...degrees, [side]: v })}
            />
          )}
          <button
            className="icon-btn"
            title="Auto-layout: re-arrange this graph"
            aria-label={`Auto-layout ${t.meta.tradition.shortName} graph`}
            onClick={() => setLayoutKey({ ...layoutKey, [side]: layoutKey[side] + 1 })}
          >
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
              <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="5" cy="5" r="2.2" />
                <circle cx="15" cy="6.5" r="2.2" />
                <circle cx="8" cy="15" r="2.2" />
                <path d="M7 5.6l5.8.6M6 7l1.4 5.8M13.5 8.3l-4 5" />
              </g>
            </svg>
          </button>
          <PaneSettings
            active={minTier[side] < t.meta.tradition.tiers.length - 1}
            label={`${t.meta.tradition.shortName} settings`}
          >
            <label className="tier-filter" title="Fade claims whose strongest authority is below this tier">
              <span>Minimum authority tier</span>
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
              <small className="muted">Claims backed only by lower tiers are faded (model view).</small>
            </label>
          </PaneSettings>
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
          edgeFilter={focusCoverage && isolate ? focusCoverage[side].edges : undefined}
          layoutKey={layoutKey[side]}
          metaKeep={metaKeep?.[side]}
          spotlight={spotlight?.[side]}
          pulse={hover?.side === side ? hover.ids : undefined}
        />
        {coverage && coverage[side].status !== "modeled" && topicFocus && (
          <div className="pane-note">
            <strong>{topicFocus.label}</strong>
            {coverage[side].status === "outline" ? (
              <span>
                In {possessive(t.meta.tradition.shortName)} outline ({coverage[side].items.map((i) => i.label).join("; ")}), not yet modeled.
              </span>
            ) : topicFocus.kind === "debate" ? (
              <span>
                {coverage[side].stance
                  ? `${possessive(t.meta.tradition.shortName)} stance is recorded, but no modeled claim expresses it yet.`
                  : `No stance recorded for ${t.meta.tradition.shortName}.`}
              </span>
            ) : (
              <span>Not in {possessive(t.meta.tradition.shortName)} outline or model.</span>
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
      onHover: (ids) => setHover(ids ? { side, ids } : null),
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
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="modes" aria-label="View modes">
          {focus && (
            <>
              <ModeSwitch name="Focus" options={FOCUS_MODES} value={focusMode} onChange={setFocusMode} />
              <span className="modes-sep" />
            </>
          )}
          <ModeSwitch name="Layout" options={LAYOUT_MODES} value={mode} onChange={setMode} />
          <span className="modes-sep" />
          <ModeSwitch name="View" options={VIEWS} value={view} onChange={setView} />
          {view === "model" && (
            <>
              <span className="modes-sep" />
              <ModeSwitch name="Categories as" options={GROUPINGS} value={grouping} onChange={setGrouping} />
            </>
          )}
          {!single && (
            <>
              <span className="modes-sep" />
              <button
                className={`icon-toggle ${crosswalkOn ? "on" : ""}`}
                aria-pressed={crosswalkOn}
                aria-label="Crosswalk: draw links between corresponding categories of the two traditions"
                onClick={() => setCrosswalkOn(!crosswalkOn)}
              >
                {ICONS.crosswalk}
                <span className="tip" role="tooltip">
                  <strong>Crosswalk {crosswalkOn ? "(on)" : "(off)"}</strong>
                  Draw links between corresponding categories of the two traditions: curated matches, and pairs derived from shared subjects.
                </span>
              </button>
            </>
          )}
        </div>
        <div className="controls">
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
              {focusTopic && !(sel && (sel.kind === "topic" || sel.kind === "referent") && sel.id === focus) && (
                <button className="crumb-back" onClick={() => setSel(focusSelection(focusTopic.id))}>
                  ← {focusTopic.label}
                </button>
              )}
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
