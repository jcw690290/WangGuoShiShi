import { z } from "zod";
import data from "./endings.zh.json" with { type: "json" };

const story = z.object({ title: z.string(), conditions: z.string(), story: z.string() });
export const endingCatalog = z.record(z.string(), z.object({
  name: z.string(), victory: story, defeat: story,
})).parse(data);
