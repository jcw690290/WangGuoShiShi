import { z } from "zod";

const ring = z.array(z.tuple([z.number(), z.number()])).min(4);
const polygon = z.array(ring).nonempty();
const geometry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygon }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygon).min(1) }),
]);
const collection = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      properties: z.object({ id: z.string() }),
      geometry: z.unknown(),
    }),
  ),
});

type Ring = z.infer<typeof ring>;
export type StateGeometry = Record<string, z.infer<typeof polygon>[]>;

const samePoint = ([ax, ay]: Ring[number], [bx, by]: Ring[number]) =>
  Math.hypot(ax - bx, ay - by) <= 1e-8;

// The atlas contains duplicate vertices with floating-point noise. Pixi's
// stroke tessellator can divide by zero when it encounters these short edges.
function cleanRing(points: Ring): Ring {
  const cleaned = [points[0]];
  for (const point of points.slice(1)) {
    if (!samePoint(point, cleaned.at(-1)!)) cleaned.push(point);
  }
  if (samePoint(cleaned[0], cleaned.at(-1)!)) cleaned.pop();
  return cleaned.length < 3 ? [] : [...cleaned, cleaned[0]];
}

export async function loadGeometry(stateIds: string[]): Promise<StateGeometry> {
  const response = await fetch(new URL("../../resources/victoria3_1820_states.geojson", import.meta.url));
  if (!response.ok) throw new Error(`地图加载失败（HTTP ${response.status}）`);
  return parseGeometry(await response.json(), stateIds);
}

export function parseGeometry(data: unknown, stateIds: string[]): StateGeometry {
  const { features } = collection.parse(data);
  const byId = new Map(features.map((feature) => [feature.properties.id, feature.geometry]));
  if (byId.size !== features.length || byId.size !== stateIds.length)
    throw new Error("地图与世界剧本的州集合不一致");
  return Object.fromEntries(
    stateIds.map((id) => {
      const shape = geometry.parse(byId.get(id));
      const polygons = shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
      const cleaned = polygons.flatMap(([shell, ...holes]) => {
        const outline = cleanRing(shell);
        return outline.length ? [[outline, ...holes.map(cleanRing).filter((hole) => hole.length)]] : [];
      });
      if (!cleaned.length) throw new Error(`州没有有效的地图轮廓：${id}`);
      return [id, cleaned];
    }),
  );
}
