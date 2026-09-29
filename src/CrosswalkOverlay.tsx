import type { Core, NodeSingular } from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { MATCH_LABEL, type CrosswalkLink } from "./crosswalk";
import { categoryAnchorIds, type Grouping, type View } from "./graph";
import type { Metamodel } from "./schema";
import type { Side } from "./selection";

interface Props {
  links: CrosswalkLink[];
  cys: Record<Side, Core | null>;
  metas: Record<Side, Metamodel>;
  view: View;
  grouping: Grouping;
  selectedId?: string;
  onSelect: (id: string) => void;
}

interface Segment {
  link: CrosswalkLink;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  offscreen: boolean;
}

/** First anchor element that is drawn for a category (itself, else its nearest drawn ancestor). */
function anchor(cy: Core, meta: Metamodel, categoryId: string, view: View, grouping: Grouping): NodeSingular | undefined {
  for (const id of categoryAnchorIds(meta, categoryId, view, grouping)) {
    const el = cy.getElementById(id);
    if (el.nonempty() && el.isNode()) return el;
  }
}

/**
 * SVG layer over both panes that draws crosswalk links between the left and right traditions' categories.
 * Positions follow each pane's pan/zoom.
 */
export function CrosswalkOverlay({ links, cys, metas, view, grouping, selectedId, onSelect }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [hover, setHover] = useState<string>();

  useEffect(() => {
    const { left, right } = cys;
    if (!left || !right) return setSegments([]);
    let frame = 0;
    const compute = () => {
      const host = svg.current?.getBoundingClientRect();
      if (!host) return;
      const lRect = left.container()!.getBoundingClientRect();
      const rRect = right.container()!.getBoundingClientRect();
      const out: Segment[] = [];
      for (const link of links) {
        if (!link.left || !link.right) continue;
        const a = anchor(left, metas.left, link.left, view, grouping);
        const b = anchor(right, metas.right, link.right, view, grouping);
        if (!a || !b) continue;
        const ba = a.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        const bb = b.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        // Exit the left category on its right edge and enter the right category on its left edge.
        let x1 = lRect.left + ba.x2 - host.left;
        let y1 = lRect.top + (ba.y1 + ba.y2) / 2 - host.top;
        let x2 = rRect.left + bb.x1 - host.left;
        let y2 = rRect.top + (bb.y1 + bb.y2) / 2 - host.top;
        const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
        const lx = [lRect.left - host.left, lRect.right - host.left];
        const rx = [rRect.left - host.left, rRect.right - host.left];
        const ly = [lRect.top - host.top, lRect.bottom - host.top];
        const ry = [rRect.top - host.top, rRect.bottom - host.top];
        const offscreen = x1 < lx[0] || x1 > lx[1] || y1 < ly[0] || y1 > ly[1] || x2 < rx[0] || x2 > rx[1] || y2 < ry[0] || y2 > ry[1];
        x1 = clamp(x1, lx[0], lx[1]);
        y1 = clamp(y1, ly[0], ly[1]);
        x2 = clamp(x2, rx[0], rx[1]);
        y2 = clamp(y2, ry[0], ry[1]);
        out.push({ link, x1, y1, x2, y2, offscreen });
      }
      setSegments(out);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };
    schedule();
    for (const cy of [left, right]) cy.on("render viewport layoutstop resize", schedule);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    if (svg.current) ro.observe(svg.current);
    return () => {
      cancelAnimationFrame(frame);
      for (const cy of [left, right]) if (!cy.destroyed()) cy.off("render viewport layoutstop resize", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [cys, links, metas, view, grouping]);

  return (
    <svg ref={svg} className="crosswalk-overlay" aria-label="Crosswalk links">
      {segments.map(({ link, x1, y1, x2, y2, offscreen }) => {
        const dx = Math.max(60, (x2 - x1) * 0.45);
        const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        const kind = link.curated ? link.match : "derived";
        const active = link.id === selectedId || link.id === hover;
        const label = link.curated ? MATCH_LABEL[link.match] : `shared: ${link.referents.length}`;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        return (
          <g
            key={link.id}
            className={`xw-link xw-${kind} ${active ? "active" : ""} ${offscreen ? "offscreen" : ""}`}
            onClick={() => onSelect(link.id)}
            onMouseEnter={() => setHover(link.id)}
            onMouseLeave={() => setHover(undefined)}
          >
            <title>
              {link.curated
                ? `${MATCH_LABEL[link.match]}: ${link.curated.note}`
                : `Derived from shared referents (${link.referents.length})`}
            </title>
            <path className="xw-hit" d={d} />
            <path className="xw-line" d={d} />
            <circle className="xw-end" cx={x1} cy={y1} r={3} />
            <circle className="xw-end" cx={x2} cy={y2} r={3} />
            {active && (
              <g transform={`translate(${mx},${my})`}>
                <rect className="xw-label-bg" x={-label.length * 3.2 - 8} y={-10} width={label.length * 6.4 + 16} height={20} rx={10} />
                <text className="xw-label" textAnchor="middle" dy="4">
                  {label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
