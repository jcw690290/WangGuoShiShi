import type { StateGeometry } from "./geometry.ts";
import type { Point } from "./viewport.ts";

type Ring = [number, number][];
function onEdge(p: Point, a: number[], b: number[]) {
  const cross = (p.x - a[0]) * (b[1] - a[1]) - (p.y - a[1]) * (b[0] - a[0]);
  return (
    Math.abs(cross) < 1e-8 &&
    p.x >= Math.min(a[0], b[0]) &&
    p.x <= Math.max(a[0], b[0]) &&
    p.y >= Math.min(a[1], b[1]) &&
    p.y <= Math.max(a[1], b[1])
  );
}
export function inRing(p: Point, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (onEdge(p, a, b)) return true;
    if (
      a[1] > p.y !== b[1] > p.y &&
      p.x < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function hitState(geometry: StateGeometry, point: Point): string | null {
  for (const [id, polygons] of Object.entries(geometry))
    if (
      polygons.some(
        ([shell, ...holes]) =>
          inRing(point, shell) && !holes.some((hole) => inRing(point, hole)),
      )
    )
      return id;
  return null;
}
