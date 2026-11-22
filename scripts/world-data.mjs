// Rebuild local scenario metadata from the supplied 1200 × 575 map. No GIS projection.
import fs from "node:fs";
import { oceanCoasts } from "./world-coasts.mjs";
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const {
  features,
  properties: { width, height },
} = read("resources/victoria3_1820_states.geojson");
// Original image coordinates. Preserve ocean access where a narrow strait closes on the grid.
const coasts = oceanCoasts(features, width, height, [
  ["Mediterranean Sea", 613, 171],
  ["Baltic Sea", 669, 89],
  ["Black Sea", 714, 153],
  ["Red Sea", 727, 236],
  ["Persian Gulf", 773, 215],
]);
const source = read("resources/1820_game_data.json");
const demo = read("src/scenario/qing-vietnam.json");
const profiles = new Map(demo.states.map((s) => [s.id, s]));
const atlas = {};
const cells = new Map();
const edges = [];
// Match near-parallel boundary segments in a one-pixel spatial grid. Reject point contacts.
for (const {
  properties: { id, name },
  geometry,
} of features) {
  if (atlas[id]) throw new Error("Duplicate state " + id);
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let area = 0,
    largest = 0,
    label;
  const shared = new Map();
  for (const rings of polygons) {
    for (const [ringIndex, ring] of rings.entries()) {
      let twiceArea = 0,
        cx = 0,
        cy = 0;
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i - 1],
          [u, v] = ring[i];
        const dx = u - x,
          dy = v - y,
          length = Math.hypot(dx, dy);
        if (length < 0.00001) continue;
        const cross = x * v - u * y;
        twiceArea += cross;
        cx += (x + u) * cross;
        cy += (y + v) * cross;
        const segment = { id, x, y, dx, dy, length };
        const seen = new Set();
        for (let a = Math.floor(Math.min(x, u) - 0.1); a <= Math.floor(Math.max(x, u) + 0.1); a++) {
          for (let b = Math.floor(Math.min(y, v) - 0.1); b <= Math.floor(Math.max(y, v) + 0.1); b++) {
            const key = a + "," + b;
            if (!cells.has(key)) cells.set(key, []);
            const bucket = cells.get(key);
            for (const other of bucket) {
              if (other.id === id || seen.has(other)) continue;
              seen.add(other);
              const ox = other.x - x,
                oy = other.y - y;
              if (
                Math.abs(dx * other.dy - dy * other.dx) > length * other.length * 0.18 ||
                Math.abs(dx * oy - dy * ox) > length * 0.1
              )
                continue;
              const p = (ox * dx + oy * dy) / length;
              const q = p + (other.dx * dx + other.dy * dy) / length;
              const overlap = Math.min(length, Math.max(p, q)) - Math.max(0, Math.min(p, q));
              if (overlap > 0) shared.set(other.id, (shared.get(other.id) ?? 0) + overlap);
            }
            bucket.push(segment);
          }
        }
      }
      const size = Math.abs(twiceArea) / 2;
      area += ringIndex === 0 ? size : -size;
      if (ringIndex === 0 && size > largest) {
        largest = size;
        label = [cx / (3 * twiceArea), cy / (3 * twiceArea)].map((n) => +n.toFixed(2));
      }
    }
  }
  const profile = profiles.get(id);
  const variation = [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 1820);
  const population =
    profile?.population ?? (12 + Math.min(28, Math.round(Math.sqrt(area) / 2)) + (variation % 6)) * 1000;
  const grain = profile?.buildings.grain ?? Math.max(1, Math.floor(population / 12000));
  const cloth = profile?.buildings.cloth ?? variation % 3;
  atlas[id] = {
    name: profile?.name ?? name,
    label: profile?.label ?? label,
    neighbors: [],
    population,
    grainTransport: profile?.grainTransport ?? 1600 + (variation % 2700),
    buildings: { grain, cloth },
    capacity: profile?.capacity ?? { grain: grain + 3, cloth: cloth + 3 },
    terrain: ["平原", "森林", "山地"][variation % 3],
    coastal: coasts.has(id),
  };
  for (const [other, length] of shared) if (length >= 0.65) edges.push([id, other]);
}
for (const [a, b] of edges) {
  atlas[a].neighbors.push(b);
  atlas[b].neighbors.push(a);
}
for (const state of Object.values(atlas)) state.neighbors.sort();
for (const id of Object.keys(source.states)) if (!atlas[id]) throw new Error("Missing geometry " + id);
fs.writeFileSync("src/scenario/world-states.json", JSON.stringify(atlas, null, 0) + "\n");
console.log(features.length, "states,", edges.length, "land borders");
