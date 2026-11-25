import { z } from "zod";
import data from "./endings.zh.json" with { type: "json" };
import type { EndingRecord } from "../game/campaign.ts";

const story = z.object({ title: z.string(), conditions: z.string(), story: z.string() });
export const endingCatalog = z.record(z.string(), z.object({
  name: z.string(), victory: story, defeat: story,
})).parse(data);

export function endingTitle(record: EndingRecord) {
  const story = endingCatalog[record.countryId];
  switch (record.kind) {
    case "victory": return story?.victory.title ?? "专属胜利";
    case "defeat": return story?.defeat.title ?? "战役失败";
    case "extinct": return story?.defeat.title ?? "正式灭国";
    case "genericVictory": return "民生典范";
    case "neutral": return "未竟之志";
  }
}

export function endingStory(record: EndingRecord) {
  const story = endingCatalog[record.countryId];
  if (record.kind === "victory") return story?.victory.story;
  if (record.kind === "defeat" || record.kind === "extinct") return story?.defeat.story;
  if (record.kind === "genericVictory") return "民生、识字、基本消费与财政连续五年达到目标。";
}
