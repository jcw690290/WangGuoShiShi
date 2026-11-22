export interface Point {
  x: number;
  y: number;
}
export interface Viewport {
  width: number;
  height: number;
  zoom: number;
  x: number;
  y: number;
}
export const MAP_WIDTH = 1200,
  MAP_HEIGHT = 575;
export const MIN_ZOOM = 1,
  MAX_ZOOM = 16;
export const scaleOf = (v: Viewport) =>
  Math.min(v.width / MAP_WIDTH, v.height / MAP_HEIGHT) * v.zoom;

export function constrain(v: Viewport): Viewport {
  const scale = scaleOf(v);
  const axis = (offset: number, size: number, mapSize: number) =>
    mapSize <= size
      ? (size - mapSize) / 2
      : Math.max(size - mapSize, Math.min(0, offset));
  return {
    ...v,
    x: axis(v.x, v.width, MAP_WIDTH * scale),
    y: axis(v.y, v.height, MAP_HEIGHT * scale),
  };
}
export function fitView(width: number, height: number): Viewport {
  return constrain({ width, height, zoom: 1, x: 0, y: 0 });
}
export function worldPoint(v: Viewport, p: Point): Point {
  const scale = scaleOf(v);
  return { x: (p.x - v.x) / scale, y: (p.y - v.y) / scale };
}
export function zoomAt(
  v: Viewport,
  factor: number,
  from: Point,
  to = from,
): Viewport {
  const anchor = worldPoint(v, from);
  const next = {
    ...v,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor)),
  };
  const scale = scaleOf(next);
  return constrain({
    ...next,
    x: to.x - anchor.x * scale,
    y: to.y - anchor.y * scale,
  });
}
export function pan(v: Viewport, x: number, y: number) {
  return constrain({ ...v, x: v.x + x, y: v.y + y });
}
export function focusAt(v: Viewport, point: Point, zoom = 5) {
  const next = { ...v, zoom },
    scale = scaleOf(next);
  return constrain({
    ...next,
    x: v.width / 2 - point.x * scale,
    y: v.height / 2 - point.y * scale,
  });
}
export function resizeView(v: Viewport, width: number, height: number) {
  const center = worldPoint(v, { x: v.width / 2, y: v.height / 2 });
  return focusAt({ ...v, width, height }, center, v.zoom);
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

// Pure pointer state machine. All coordinates and thresholds use CSS pixels.
export class MapGesture {
  readonly pointers = new Map<number, Point>();
  private baseline = new Map<number, Point>();
  private baseView: Viewport;
  private blocked = false;
  private start: Point = { x: 0, y: 0 };
  view: Viewport;
  constructor(view: Viewport) {
    this.view = view;
    this.baseView = view;
  }
  private rebase() {
    this.baseView = this.view;
    this.baseline = new Map(this.pointers);
  }
  setView(view: Viewport) {
    this.view = view;
    if (this.pointers.size) this.blocked = true;
    this.rebase();
  }
  down(id: number, point: Point) {
    if (!this.pointers.size) {
      this.blocked = false;
      this.start = point;
    }
    this.pointers.set(id, point);
    if (this.pointers.size > 1) this.blocked = true;
    this.rebase();
  }
  move(id: number, point: Point) {
    if (!this.pointers.has(id)) return;
    const previous = this.pointers.get(id)!;
    this.pointers.set(id, point);
    const ids = [...this.pointers.keys()];
    const a = this.baseline.get(ids[0])!,
      p = this.pointers.get(ids[0])!;
    if (ids.length === 1) {
      const wasDragging = this.blocked;
      if (distance(a, p) > 5) this.blocked = true;
      if (this.blocked) {
        const from = wasDragging ? previous : a;
        this.view = pan(this.view, p.x - from.x, p.y - from.y);
      }
      return;
    }
    const b = this.baseline.get(ids[1])!,
      q = this.pointers.get(ids[1])!;
    const before = distance(a, b);
    if (before < 1) {
      this.rebase();
      return;
    }
    this.view = zoomAt(
      this.baseView,
      Math.max(1, distance(p, q)) / before,
      midpoint(a, b),
      midpoint(p, q),
    );
  }
  up(id: number, point: Point): { start: Point; end: Point } | null {
    if (!this.pointers.has(id)) return null;
    this.move(id, point);
    const tap =
      this.pointers.size === 1 && !this.blocked
        ? { start: this.start, end: point }
        : null;
    this.pointers.delete(id);
    this.rebase();
    return tap;
  }
  cancel(id: number) {
    if (!this.pointers.delete(id)) return;
    this.blocked = true;
    this.rebase();
  }
}
