import type { Country, Scenario } from "../scenario/scenario.ts";
import type { StateGeometry } from "./geometry.ts";
import { inRing } from "./hitTest.ts";

export const UNCLAIMED_COLOR = "#d6c599";
// Presentation-only tints inspired by printed political atlases. Source data is unchanged.
const atlasTints: Record<string, string> = {
  country_01: "#e7cf85",
  country_02: "#ce8885",
  country_08: "#94b7c6",
  country_09: "#8da86e",
  country_22: "#8ebbc8",
  country_24: "#a6c3bc",
  country_25: "#a9b7d0",
  country_26: "#a8c6ad",
  country_27: "#d7a0a4",
  country_28: "#839ac5",
  country_29: "#8ab8ad",
};
export const countryColor = (country: Country) =>
  paperColor(atlasTints[country.id] ?? country.color);
export function paperColor(hex: string): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (
    "#" +
    rgb
      .map((c, i) =>
        Math.round(c * 0.68 + [244, 229, 186][i] * 0.32)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const areaOf = (ring: [number, number][]) =>
  Math.abs(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;

// Polygon centroids can fall into water on a concave coast. Choose an interior
// scanline span when that happens, respecting islands and holes.
function labelPoint(
  polygons: StateGeometry[string],
  preferred: [number, number],
): [number, number] {
  const point = { x: preferred[0], y: preferred[1] };
  if (
    polygons.some(
      ([shell, ...holes]) =>
        inRing(point, shell) && !holes.some((h) => inRing(point, h)),
    )
  )
    return preferred;
  let best: [number, number] = preferred,
    score = -Infinity;
  for (const rings of polygons) {
    const ys = rings[0].map((p) => p[1]),
      low = Math.min(...ys),
      high = Math.max(...ys);
    for (let row = 0; row < 24; row++) {
      const y = low + ((high - low) * (row + 0.5)) / 24,
        xs: number[] = [];
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i];
          if (a[1] > y !== b[1] > y)
            xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
        }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x = (xs[i] + xs[i + 1]) / 2,
          rank =
            xs[i + 1] -
            xs[i] -
            Math.hypot(x - preferred[0], y - preferred[1]) * 0.2;
        if (rank > score) {
          best = [x, y];
          score = rank;
        }
      }
    }
  }
  return best;
}

// Place each name in its largest connected territory, not halfway across an ocean.
export function countryLabels(
  scenario: Scenario,
  owners: Record<string, string>,
  geometry: StateGeometry,
) {
  const areas = Object.fromEntries(
    Object.entries(geometry).map(([id, polygons]) => [
      id,
      polygons.reduce(
        (sum, [shell, ...holes]) =>
          sum + areaOf(shell) - holes.reduce((a, h) => a + areaOf(h), 0),
        0,
      ),
    ]),
  );
  return Object.keys(scenario.countries).flatMap((owner) => {
    const remaining = new Set(
      Object.keys(owners).filter((id) => owners[id] === owner),
    );
    let main: string[] = [],
      mainArea = 0;
    while (remaining.size) {
      const component = [remaining.values().next().value!];
      remaining.delete(component[0]);
      for (const id of component)
        for (const next of scenario.states[id].neighbors)
          if (remaining.delete(next)) component.push(next);
      const area = component.reduce((sum, id) => sum + areas[id], 0);
      if (area > mainArea) {
        main = component;
        mainArea = area;
      }
    }
    if (!main.length) return [];
    const center = main.reduce(
      (p, id) => {
        const [x, y] = scenario.states[id].label;
        return {
          x: p.x + (x * areas[id]) / mainArea,
          y: p.y + (y * areas[id]) / mainArea,
        };
      },
      { x: 0, y: 0 },
    );
    const anchor = main.reduce((a, b) => {
      const d = (id: string) =>
        Math.hypot(
          scenario.states[id].label[0] - center.x,
          scenario.states[id].label[1] - center.y,
        );
      return d(a) <= d(b) ? a : b;
    });
    return [
      {
        owner,
        position: labelPoint(geometry[anchor], scenario.states[anchor].label),
        size: Math.max(5, Math.min(28, Math.sqrt(mainArea) * 0.13)),
        area: mainArea,
      },
    ];
  });
}

// Shared edges disappear within a country; province hairlines remain in the fill layer.
export function mapEdges(geometry: StateGeometry) {
  const edges = new Map<
    string,
    { a: number[]; b: number[]; states: string[] }
  >();
  const key = (p: number[]) => p.map((n) => Math.round(n * 100)).join(",");
  for (const [id, polygons] of Object.entries(geometry))
    for (const rings of polygons)
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i],
            ka = key(a),
            kb = key(b);
          if (ka === kb) continue;
          const k = ka < kb ? ka + ":" + kb : kb + ":" + ka;
          const old = edges.get(k);
          if (old) old.states.push(id);
          else edges.set(k, { a, b, states: [id] });
        }
  return [...edges.values()];
}
