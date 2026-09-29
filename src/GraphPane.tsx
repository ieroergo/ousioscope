import cytoscape, { type Core, type StylesheetJson } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useEffect, useMemo, useRef } from "react";
import { metamodelElements, modelElements, type View } from "./graph";
import type { Tradition } from "./schema";
import type { Mark, Selection, Side } from "./selection";

cytoscape.use(fcose);

const STYLE: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "118px",
      "font-size": 11,
      "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
      "text-valign": "center",
      "text-halign": "center",
      shape: "round-rectangle",
      width: 130,
      height: 46,
      "background-color": "data(color)",
      "background-opacity": 0.22,
      color: "#1e293b",
      "border-width": 1,
      "border-color": "data(color)",
    },
  },
  {
    selector: "node.individual",
    style: { "border-width": 2, "font-weight": 600, "background-opacity": 0.3 },
  },
  {
    selector: "node.kind",
    style: {
      "background-color": "#ffffff",
      "border-style": "dashed",
      "border-width": 2,
      "border-color": "data(color)",
      "font-style": "italic",
      color: "#334155",
    },
  },
  {
    selector: ":parent",
    style: {
      "background-opacity": 0.05,
      "border-color": "data(color)",
      "border-width": 1.5,
      "border-opacity": 0.6,
      "text-valign": "top",
      "text-halign": "center",
      "font-size": 12,
      "font-weight": 600,
      color: "#475569",
      padding: "20px",
      "text-margin-y": -6,
    },
  },
  { selector: "node.category", style: { width: 140, height: 40 } },
  { selector: "node.group-category", style: { "border-width": 3, "border-color": "data(color)", "background-opacity": 0.35 } },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      width: 1.3,
      "line-color": "#b4bfd0",
      "target-arrow-color": "#b4bfd0",
      label: "data(label)",
      "font-size": 9.5,
      "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
      color: "#526077",
      "text-rotation": "autorotate",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.92,
      "text-background-padding": "2px",
      "text-background-shape": "roundrectangle",
    },
  },
  { selector: "edge.isa", style: { "line-style": "dashed", "target-arrow-shape": "triangle-backcurve", color: "#64748b" } },
  {
    selector: "edge.reltype",
    style: { "line-color": "#cbd5e1", "target-arrow-color": "#cbd5e1", "line-style": "dotted", color: "#94a3b8" },
  },
  { selector: "edge.axiom", style: { "line-color": "#0ea5e9", "target-arrow-color": "#0ea5e9", width: 2.2 } },
  { selector: "edge.to-kind", style: { "line-style": "dashed" } },
  { selector: ".faded", style: { opacity: 0.18 } },
  {
    selector: "node.m-selected",
    style: { "border-width": 3.5, "border-color": "#e0435b", "underlay-color": "#e0435b", "underlay-opacity": 0.12, "underlay-padding": 6 },
  },
  { selector: "edge.m-selected", style: { width: 3, "line-color": "#e0435b", "target-arrow-color": "#e0435b" } },
  {
    selector: "node.m-bridged",
    style: { "border-width": 3.5, "border-color": "#e0435b", "border-style": "dashed", "underlay-color": "#e0435b", "underlay-opacity": 0.08, "underlay-padding": 6 },
  },
  { selector: "node.m-hit", style: { "border-width": 3.5, "border-color": "#d98a1f" } },
  { selector: "edge.m-hit", style: { width: 3, "line-color": "#d98a1f", "target-arrow-color": "#d98a1f" } },
];

interface Props {
  side: Side;
  tradition: Tradition;
  view: View;
  visible: Set<string>;
  minTier: number;
  marks: Map<string, Mark>;
  onSelect: (s: Selection | null) => void;
}

export function GraphPane({ side, tradition, view, visible, minTier, marks, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const elements = useMemo(
    () => (view === "model" ? modelElements(tradition, visible, minTier) : metamodelElements(tradition)),
    [tradition, view, visible, minTier],
  );

  useEffect(() => {
    const instance = cytoscape({
      container: container.current,
      elements,
      style: STYLE,
      wheelSensitivity: 0.3,
      layout: { name: "preset" },
    });
    (view === "model" ? instance.elements() : instance.elements().not("edge.reltype"))
      .layout(
        view === "model"
          ? ({
              name: "fcose",
              quality: "proof",
              animate: false,
              randomize: true,
              nodeDimensionsIncludeLabels: true,
              idealEdgeLength: () => 110,
              nodeRepulsion: () => 9000,
              edgeElasticity: () => 0.3,
              nestingFactor: 0.4,
              nodeSeparation: 90,
              gravity: 0.2,
              gravityCompound: 1.2,
              tile: true,
              packComponents: true,
              padding: 16,
            } as unknown as cytoscape.LayoutOptions)
          : ({
              name: "breadthfirst",
              directed: false,
              roots: instance.nodes().filter((n) => n.outgoers("edge.isa").empty()),
              spacingFactor: 1.1,
              padding: 24,
            } as unknown as cytoscape.LayoutOptions),
      )
      .run();
    instance.on("tap", (evt) => {
      const t = evt.target;
      if (t === instance) return onSelectRef.current(null);
      const id: string = t.id();
      const [prefix, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
      if (["grp", "cat", "isa", "kind"].includes(prefix)) return onSelectRef.current({ side, kind: "category", id: rest });
      if (prefix === "rel") return onSelectRef.current({ side, kind: "rel", id: rest.split(":")[0] });
      if (prefix === "ax") return onSelectRef.current({ side, kind: "axiom", id: rest });
      onSelectRef.current({ side, kind: t.isEdge() ? "edge" : "node", id });
    });
    cy.current = instance;
    // Keep the graph filling its pane when the side panel opens/closes or the window resizes.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        instance.resize();
        instance.fit(undefined, 16);
      });
    });
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      instance.destroy();
    };
  }, [elements, side, view]);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.elements().removeClass("m-selected m-bridged m-hit");
    const nodeCategory = new Map(tradition.model.nodes.map((n) => [n.id, n.category]));
    const toGraphId = (id: string) =>
      view === "metamodel" ? [`cat:${nodeCategory.get(id) ?? id}`, `ax:${id}`] : [id, `grp:${id}`, `kind:${id}`];
    marks.forEach((mark, id) => {
      for (const gid of toGraphId(id)) instance.getElementById(gid).addClass(`m-${mark}`);
      if (view === "metamodel") instance.edges(`[id ^= "rel:${id}:"]`).addClass(`m-${mark}`);
    });
  }, [marks, elements, view, tradition]);

  return <div className="graph" ref={container} />;
}
