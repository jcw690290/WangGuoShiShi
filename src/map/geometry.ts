import { z } from "zod";
import mapUrl from "../../resources/victoria3_1820_states.geojson?url";

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

export type StateGeometry = Record<string, z.infer<typeof polygon>[]>;

export async function loadGeometry(stateIds: string[]): Promise<StateGeometry> {
  const response = await fetch(mapUrl);
  if (!response.ok) throw new Error(`地图加载失败（HTTP ${response.status}）`);
  const { features } = collection.parse(await response.json());
  const byId = new Map(features.map((feature) => [feature.properties.id, feature.geometry]));
  if (byId.size !== features.length || byId.size !== stateIds.length)
    throw new Error("地图与世界剧本的州集合不一致");
  return Object.fromEntries(
    stateIds.map((id) => {
      const shape = geometry.parse(byId.get(id));
      return [id, shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates];
    }),
  );
}
