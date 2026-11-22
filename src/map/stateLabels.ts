import type { StateGeometry } from "./geometry.ts";
import { inRing } from "./hitTest.ts";

// In scaled coordinates the label rectangle has aspect ratio 1. The distance
// to the nearest boundary (including hole edges) bounds its half diagonal.
export function stateLabelBox(polygons: StateGeometry[string], aspect: number) {
  let best = { x: 0, y: 0, height: 0 };
  for (const rings of polygons) {
    const [shell, ...holes] = rings;
    const xs = shell.map(p => p[0]), ys = shell.map(p => p[1]);
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    if (Math.min(height, width / aspect) <= best.height) continue;
    for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
      const x = left + width * (col + 0.5) / 9, y = top + height * (row + 0.5) / 9;
      if (!inRing({x, y}, shell) || holes.some(h => inRing({x, y}, h))) continue;
      let nearest = Infinity;
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i-1][0] - x) / aspect, ay = ring[i-1][1] - y;
        const dx = (ring[i][0] - ring[i-1][0]) / aspect, dy = ring[i][1] - ring[i-1][1];
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
        nearest = Math.min(nearest, (ax + t * dx) ** 2 + (ay + t * dy) ** 2);
      }
      const fit = Math.sqrt(2 * nearest);
      if (fit > best.height) best = { x, y, height: fit };
    }
  }
  return best;
}
