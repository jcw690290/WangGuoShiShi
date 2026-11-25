import { z } from "zod";
import type { GameState } from "./engine.ts";
import { difficultySchema } from "./settings.ts";

export const defaultEndYear = 1936;
export const endYearSchema = z.int().min(1821).max(9999);
export const endingSchema = z.object({
  campaignId: z.uuid(),
  countryId: z.string(),
  kind: z.enum(["neutral", "extinct"]),
  date: z.iso.date(),
  difficulty: difficultySchema,
  lowestDifficulty: difficultySchema,
  treasury: z.int(),
  stateCount: z.int().nonnegative(),
  population: z.int().nonnegative(),
});
export type EndingRecord = z.infer<typeof endingSchema>;

export const campaignSchema = z.object({
  id: z.uuid(),
  endYear: endYearSchema,
  tutorialEnabled: z.boolean(),
  guideSkipped: z.boolean(),
  guideStep: z.int().min(0).max(8),
  guideWeek: z.int().nonnegative().nullable(),
  sandbox: z.boolean(),
  ending: endingSchema.nullable(),
}).refine((campaign) => !campaign.sandbox || campaign.ending?.kind === "neutral");
export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignSetup = Pick<Campaign, "id" | "endYear" | "tutorialEnabled">;

export function startCampaign(setup: CampaignSetup): Campaign {
  return { ...setup, guideSkipped: false, guideStep: 0, guideWeek: null, sandbox: false, ending: null };
}

export function finalizeCampaign(state: GameState, date: Date, ownershipChanged: boolean): GameState {
  const { campaign, playerCountryId: id } = state;
  if (!campaign || campaign.ending || id === null) return state;
  const reachedYear = date.getUTCFullYear() >= campaign.endYear;
  if (!reachedYear && !ownershipChanged) return state;
  const held = Object.keys(state.ownerByStateId).filter((site) => state.ownerByStateId[site] === id);
  if (held.length > 0 && !reachedYear) return state;
  const ending: EndingRecord = {
    campaignId: campaign.id, countryId: id, kind: held.length === 0 ? "extinct" : "neutral",
    date: date.toISOString().slice(0, 10),
    difficulty: state.settings.difficulty, lowestDifficulty: state.settings.lowestDifficulty,
    treasury: state.countryEconomies[id].treasury, stateCount: held.length,
    population: held.reduce((sum, site) => sum + state.stateEconomies[site].population, 0),
  };
  return { ...state, campaign: { ...campaign, ending } };
}

export const guideSteps = [
  ["观察暂停", "开局已经暂停。继续推进，观察日期后再暂停。"],
  ["核对财政", "打开政务菜单的经济页，区分国库余额和周收支。"],
  ["查看属州", "点选一个本国州，查看人口、就业和市场接入。"],
  ["安排项目", "查看费用和容量，在本国州安排一项可负担的建设。"],
  ["推进施工", "推进至下一次周结，再检查队列和财政。"],
  ["查看人口", "在州详情展开人口群体表，对照生活水平、工资和粮价。"],
  ["查看瓶颈", "比较周供给、需求与未满足量，区分生产与接入限制。"],
  ["设定目标", "根据刚看到的瓶颈，再安排一项可负担的短期工程。"],
] as const;

export function completeGuideStep(state: GameState, step: number): GameState {
  const campaign = state.campaign;
  if (!campaign?.tutorialEnabled || campaign.guideSkipped || campaign.guideStep !== step || step >= guideSteps.length) return state;
  return { ...state, campaign: {
    ...campaign, guideStep: step + 1,
    guideWeek: step === 3 ? Math.floor(state.elapsedDays / 7) : campaign.guideWeek,
  } };
}
