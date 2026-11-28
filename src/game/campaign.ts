import { z } from "zod";
import type { GameState } from "./engine.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { endingMetrics, outcomeCandidates } from "../scenario/endingRules.ts";
import type { EndingMetrics } from "../scenario/endingRules.ts";
import { difficultySchema } from "./settings.ts";
import { achievementProgressSchema, initialAchievementProgress } from "./achievements.ts";
import { calendarMonthsPassed } from "./time.ts";
import { campaignBaselineSchema, measureCampaign, openingMetrics } from "./campaignMetrics.ts";
import { GameRuleError } from "./rules.ts";
import { constitutionalFormSchema, countryDisplayName, stateForm } from "./constitution.ts";
import { projectTypes } from "./society.ts";

export const defaultEndYear = 1936;
export const endYearSchema = z.int().min(1821).max(9999);
const endingKind = z.enum(["neutral", "extinct", "victory", "defeat", "genericVictory"]);
type EndingKind = z.infer<typeof endingKind>;
const metricSnapshot = z.partialRecord(z.enum(endingMetrics), z.number());
export const endingSchema = z.object({
  campaignId: z.uuid(),
  countryId: z.string(),
  countryName: z.string().min(1).optional(),
  stateForm: constitutionalFormSchema.optional(),
  kind: endingKind,
  endingId: z.string().optional(),
  metrics: metricSnapshot.optional(),
  date: z.iso.date(),
  difficulty: difficultySchema,
  lowestDifficulty: difficultySchema,
  treasury: z.int(),
  stateCount: z.int().nonnegative(),
  population: z.int().nonnegative(),
});
export type EndingRecord = z.infer<typeof endingSchema>;
const since = z.int().nonnegative().nullable();
const outcomeSchema = z.object({
  baseline: campaignBaselineSchema.optional(),
  metrics: metricSnapshot,
  lossSince: since,
  victorySince: since,
  genericSince: since,
  aggressionFreeSince: z.int().nonnegative(),
});
type OutcomeWatch = z.infer<typeof outcomeSchema>;

export const campaignSchema = z.object({
  id: z.uuid(),
  endYear: endYearSchema,
  tutorialEnabled: z.boolean(),
  guideSkipped: z.boolean(),
  guideStep: z.int().min(0).max(8),
  guideWeek: z.int().nonnegative().nullable(),
  guideProject: z.object({ stateId: z.string(), good: z.enum(projectTypes), privateBuild: z.boolean() }).optional(),
  sandbox: z.boolean(),
  ending: endingSchema.nullable(),
  achievements: achievementProgressSchema.optional(),
  outcome: outcomeSchema.optional(),
}).refine((campaign) => !campaign.sandbox || !!campaign.ending && campaign.ending.kind !== "extinct");
export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignSetup = Pick<Campaign, "id" | "endYear" | "tutorialEnabled">;

export function startCampaign(setup: CampaignSetup): Campaign {
  return { ...setup, guideSkipped: false, guideStep: 0, guideWeek: null, sandbox: false, ending: null,
    achievements: initialAchievementProgress(0) };
}

export function endingId(countryId: string, kind: EndingKind) {
  return kind === "victory" || kind === "defeat" ? countryId + ":" + kind : kind;
}

function saveOutcome(scenario: Scenario, state: GameState, date: Date, campaign: Campaign, id: string, kind: EndingKind,
  metrics: EndingMetrics | undefined = campaign.outcome?.metrics): GameState {
  const held = Object.keys(state.ownerByStateId).filter((site) => state.ownerByStateId[site] === id);
  const ending: EndingRecord = {
    campaignId: campaign.id, countryId: id, kind, endingId: endingId(id, kind),
    countryName: countryDisplayName(scenario.countries[id], state.nations[id]), stateForm: stateForm(state.nations[id]),
    ...(metrics ? { metrics } : {}),
    date: date.toISOString().slice(0, 10),
    difficulty: state.settings.difficulty, lowestDifficulty: state.settings.lowestDifficulty,
    treasury: state.countryEconomies[id].treasury, stateCount: held.length,
    population: held.reduce((sum, site) => sum + state.stateEconomies[site].population, 0),
  };
  return { ...state, campaign: { ...campaign, ending } };
}

function earlyVictory(state: GameState, date: Date, watch: OutcomeWatch) {
  if (watch.lossSince !== null || !calendarMonthsPassed(date, state.elapsedDays, 120)) return;
  if (watch.victorySince !== null && calendarMonthsPassed(date, state.elapsedDays - watch.victorySince, 60))
    return "victory";
  if (watch.genericSince !== null && calendarMonthsPassed(date, state.elapsedDays - watch.genericSince, 60))
    return "genericVictory";
}

export function canSettleVictory(state: GameState, date: Date) {
  const { campaign } = state;
  return !!campaign?.outcome && !campaign.ending && earlyVictory(state, date, campaign.outcome) !== undefined;
}

export function finalizeCampaign(
  scenario: Scenario, state: GameState, date: Date, changed: boolean, settleEarly = false,
): GameState {
  const { campaign, playerCountryId: id, elapsedDays: day } = state;
  if (!campaign || campaign.ending || id === null) {
    if (settleEarly) throw new GameRuleError("当前无法结算胜利");
    return state;
  }
  const due = date.getUTCFullYear() >= campaign.endYear;
  if ((changed || due) && !Object.values(state.ownerByStateId).includes(id))
    return saveOutcome(scenario, state, date, campaign, id, "extinct",
      measureCampaign(scenario, state, id, campaign.outcome?.baseline, false));

  const previous = campaign.outcome;
  const baseline = previous?.baseline ?? (day === 0 ? openingMetrics(state, id) : undefined);
  const dispute = state.borderDispute;
  const attackedToday = dispute?.phase === "war" && dispute.claimantId === id && dispute.since === day;
  const aggressionFreeSince = attackedToday ? day : previous?.aggressionFreeSince ?? day;
  const quiet = calendarMonthsPassed(date, day - aggressionFreeSince, 240);
  const observe = !previous || changed || due || settleEarly || quiet !== (previous.metrics.AGGRESSION_FREE_20 === 1);
  const metrics = observe ? measureCampaign(scenario, state, id, baseline, quiet) : previous.metrics;
  const candidates = outcomeCandidates(id, metrics);
  const protectedYearsPassed = calendarMonthsPassed(date, day, 60);
  const lossSince = protectedYearsPassed && candidates.defeat ? previous?.lossSince ?? day : null;
  const victorySince = candidates.victory ? previous?.victorySince ?? day : null;
  const genericSince = candidates.genericVictory ? previous?.genericSince ?? day : null;
  const outcome: OutcomeWatch = { ...(baseline ? { baseline } : {}), metrics, lossSince, victorySince, genericSince, aggressionFreeSince };
  const tracked = !previous || metrics !== previous.metrics || lossSince !== previous.lossSince ||
    victorySince !== previous.victorySince || genericSince !== previous.genericSince || aggressionFreeSince !== previous.aggressionFreeSince
    ? { ...campaign, outcome } : campaign;

  if (lossSince !== null && calendarMonthsPassed(date, day - lossSince, 24))
    return saveOutcome(scenario, state, date, tracked, id, "defeat");
  if (due) {
    const kind = candidates.victory ? "victory" :
      genericSince !== null && calendarMonthsPassed(date, day - genericSince, 60) ? "genericVictory" : "neutral";
    return saveOutcome(scenario, state, date, tracked, id, kind);
  }
  if (settleEarly) {
    const kind = earlyVictory(state, date, outcome);
    if (!kind) throw new GameRuleError("胜利需要开局满十年且条件连续满足五年");
    return saveOutcome(scenario, state, date, tracked, id, kind);
  }
  return tracked === campaign ? state : { ...state, campaign: tracked };
}

export const guideSteps = [
  ["观察暂停", "开局已经暂停。继续推进，观察日期后再暂停。"],
  ["核对财政", "展开地图右上的财政状态，比较手头国库、周结余和必要支出。"],
  ["查看属州", "点选一个本国州并打开州详情，查看人口、就业、产业容量和市场接入。"],
  ["安排项目", "查看费用、用工、原料和工期，在本国州安排一项可负担的建设。"],
  ["推进施工", "推进至下一次周结，在经济页复盘施工点、实付支出和进度。"],
  ["查看人口", "在本国州打开人口群体表，对照生活水平、工资和粮价。"],
  ["查看瓶颈", "展开最近周结的商品详情，比较供给、需求、州接入和线路限制。"],
  ["设定目标", "根据瓶颈安排一项短期工程，推进到下一次周结后复盘实际结果。"],
] as const;

export function noteTutorialProject(state: GameState, project: NonNullable<Campaign["guideProject"]>) {
  const campaign = state.campaign;
  if (!campaign?.tutorialEnabled || campaign.guideSkipped ||
      (campaign.guideStep !== 3 && (campaign.guideStep !== 7 || campaign.guideProject))) return state;
  return { ...state, campaign: {
    ...campaign, guideStep: campaign.guideStep === 3 ? 4 : 7,
    guideWeek: Math.floor(state.elapsedDays / 7), guideProject: project,
  } };
}

export function tutorialReviewReady(state: GameState, countryId = state.playerCountryId) {
  const campaign = state.campaign;
  return !!campaign?.tutorialEnabled && !campaign.guideSkipped && countryId !== null &&
    (campaign.guideStep === 4 || (campaign.guideStep === 7 && campaign.guideProject !== undefined)) &&
    campaign.guideWeek !== null && Math.floor(state.elapsedDays / 7) > campaign.guideWeek &&
    !!state.lastEconomy?.countries[countryId].construction;
}

export function completeGuideStep(state: GameState, step: number): GameState {
  const campaign = state.campaign;
  if (!campaign?.tutorialEnabled || campaign.guideSkipped || campaign.guideStep !== step || step >= guideSteps.length) return state;
  if ((step === 4 || step === 7) && !tutorialReviewReady(state)) return state;
  const { guideProject: _project, ...progress } = campaign;
  return { ...state, campaign: {
    ...progress, guideStep: step + 1,
    guideWeek: step === 3 ? Math.floor(state.elapsedDays / 7) : null,
  } };
}
