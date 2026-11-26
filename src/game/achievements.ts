import { z } from "zod";
import { culturalAffinityOf } from "./culture.ts";
import { participants } from "./diplomacy.ts";
import type { EconomyReport } from "./economy.ts";
import type { GameState } from "./engine.ts";
import { governanceOf } from "./governance.ts";
import { goods } from "./industry.ts";
import { difficultySchema } from "./settings.ts";
import { facilityTypes } from "./society.ts";
import { DAY_MS } from "./time.ts";

const ids = ["construction", "materials", "education", "trade", "culture", "integration", "diplomacy", "recovery", "peace"] as const;
type AchievementId = (typeof ids)[number];
export const achievementCatalog = {
  construction: { title: "初建完成", condition: "一次周结中完成本国州的建设。" },
  materials: { title: "施工配套", condition: "推进施工时，建造部门同时取得粮食和布匹。" },
  education: { title: "教育开办", condition: "大学教学岗位收到实际工资。" },
  trade: { title: "贸易成交", condition: "本国参与一笔实际跨市场交付。" },
  culture: { title: "文化交流", condition: "一个外部州对本国文化的亲近度首次升至 60。" },
  integration: { title: "领土整合", condition: "完成一州的行政整合。" },
  diplomacy: { title: "外交协议", condition: "作为提出方取得一份执行核心要求的协议。" },
  recovery: { title: "危机恢复", condition: "经历信用限制或违约后，恢复稳定财政。" },
  peace: { title: "十年和平", condition: "连续十个游戏历年未成为交战方。" },
} satisfies Record<AchievementId, { title: string; condition: string }>;

export const achievementRecordSchema = z.object({
  id: z.enum(ids),
  campaignId: z.uuid(),
  countryId: z.string(),
  date: z.iso.date(),
  difficulty: difficultySchema,
  lowestDifficulty: difficultySchema,
});
export type AchievementRecord = z.infer<typeof achievementRecordSchema>;
export const achievementProgressSchema = z.object({
  records: z.array(achievementRecordSchema).max(ids.length),
  peaceSince: z.int().nonnegative().nullable(),
  creditCrisis: z.boolean(),
}).refine(({ records }) => new Set(records.map(({ id }) => id)).size === records.length);

export function initialAchievementProgress(day: number) {
  return { records: [] as AchievementRecord[], peaceSince: day, creditCrisis: false };
}

export function achievementKey(record: AchievementRecord) {
  return record.campaignId + "/" + record.id;
}

export function advanceAchievements(before: GameState, game: GameState, date: Date, weekly?: EconomyReport): GameState {
  const { campaign, playerCountryId: countryId } = game;
  if (!campaign || campaign.ending || countryId === null) return game;
  const existing = campaign.achievements;
  const progress = existing ?? initialAchievementProgress(game.elapsedDays);
  const earned = new Set(progress.records.map(({ id }) => id));
  const awarded: AchievementId[] = [];
  function award(id: AchievementId, condition: boolean) {
    if (condition && !earned.has(id)) awarded.push(id);
  }

  let creditCrisis = progress.creditCrisis;
  if (weekly) {
    const holdings = Object.keys(game.ownerByStateId).filter((stateId) =>
      game.ownerByStateId[stateId] === countryId && before.ownerByStateId[stateId] === countryId,
    );
    award("construction", !earned.has("construction") && holdings.some((site) =>
      goods.some((good) => game.stateEconomies[site].buildings[good] > before.stateEconomies[site].buildings[good]) ||
      facilityTypes.some((facility) => game.societies[site][facility] > before.societies[site][facility]),
    ));
    const country = weekly.countries[countryId];
    award("materials", country.capacity > 0 && holdings.some((site) => {
      const materials = weekly.states[site].constructionGoods;
      return !!materials && materials.wood > 0 && materials.tools > 0 && materials.iron > 0;
    }));
    award("education", (country.universityWages ?? 0) > 0);
    award("trade", !!weekly.trade?.some(({ from, to, quantity }) =>
      quantity > 0 && (before.ownerByStateId[from] === countryId || before.ownerByStateId[to] === countryId),
    ));
    award("integration", holdings.some((site) =>
      !governanceOf(before.societies[site]).integrated && governanceOf(game.societies[site]).integrated,
    ));
    const risk = game.countryEconomies[countryId].fiscal!.week.risk;
    const previousRisk = before.countryEconomies[countryId].fiscal?.week.risk;
    creditCrisis ||= risk === "restricted" || risk === "defaulted" || previousRisk === "restricted" || previousRisk === "defaulted";
    award("recovery", creditCrisis && risk === "stable");
  }
  if (!earned.has("culture") && before.lastPopulation !== game.lastPopulation) {
    award("culture", Object.entries(game.societies).some(([site, society]) =>
      game.ownerByStateId[site] !== countryId && !!before.societies[site] &&
      (culturalAffinityOf(society)[countryId] ?? 0) >= 60 &&
      (culturalAffinityOf(before.societies[site])[countryId] ?? 0) < 60,
    ));
  }
  const dispute = game.borderDispute;
  award("diplomacy", !!dispute && dispute.phase === "resolved" && dispute.outcome === "victory" &&
    dispute.claimantId === countryId && before.borderDispute?.phase !== "resolved");
  const atWar = dispute?.phase === "war" && participants(dispute).includes(countryId);
  const peaceSince = atWar ? null : progress.peaceSince ?? game.elapsedDays;
  if (peaceSince !== null && !earned.has("peace") && game.elapsedDays - peaceSince >= 3650) {
    const anniversary = new Date(date.getTime() - (game.elapsedDays - peaceSince) * DAY_MS);
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 10);
    award("peace", date >= anniversary);
  }
  if (!awarded.length && existing && peaceSince === progress.peaceSince && creditCrisis === progress.creditCrisis) return game;
  const records = awarded.length ? [...progress.records, ...awarded.map((id): AchievementRecord => ({
    id, campaignId: campaign.id, countryId, date: date.toISOString().slice(0, 10),
    difficulty: game.settings.difficulty, lowestDifficulty: game.settings.lowestDifficulty,
  }))] : progress.records;
  return { ...game, campaign: { ...campaign, achievements: { records, peaceSince, creditCrisis } } };
}
