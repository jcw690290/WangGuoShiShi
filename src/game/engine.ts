import { GameRuleError } from "./rules.ts";
import { changeDifficulty, initialSettings, openingReserve } from "./settings.ts";
import type { Difficulty, GameSettings, RuleTuning } from "./settings.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { advanceFront, aiDiplomacy, applyBorderCommand, planWar, tickDiplomacy } from "./diplomacy.ts";
import type { BorderCommand, BorderDispute } from "./diplomacy.ts";
import { chooseConstruction, chooseUniversity, constructionError, projects, settleEconomy } from "./economy.ts";
import type { Building, CountryEconomy, EconomyReport, StateEconomy } from "./economy.ts";
import { advancePolitics, applyPolitics, availableTech, politicsError } from "./politics.ts";
import type { PoliticsCommand } from "./politics.ts";
import { initSociety, techs, hash } from "./society.ts";
import type { Nation, SiteSocial } from "./society.ts";
import { applyClaim } from "./territory.ts";
import { settlePopulationMonth } from "./demographics.ts";
import type { PopulationMonth } from "./demographics.ts";
import { finalizeCampaign, startCampaign } from "./campaign.ts";
import type { Campaign, CampaignSetup } from "./campaign.ts";
import { fiscalWeekFraction } from "./fiscal.ts";
import type { Occupation } from "./occupation.ts";

export interface GameState {
  elapsedDays: number;
  tickInDay: number;
  settings: GameSettings;
  playerCountryId: string | null;
  rng: number;
  // Only sovereign/claimed states have keys; unclaimed map states are absent.
  ownerByStateId: Record<string, string>;
  stateEconomies: Record<string, StateEconomy>;
  countryEconomies: Record<string, CountryEconomy>;
  nations: Record<string, Nation>;
  societies: Record<string, SiteSocial>;
  lastEconomy: EconomyReport | null;
  lastPopulation: PopulationMonth | null;
  campaign?: Campaign;
  borderDispute: BorderDispute | null;
  occupation?: Occupation;
}
export type Span = "day" | "week" | "halfYear";
export type GameCommand =
  | { type: "selectCountry"; countryId: string }
  | { type: "setDifficulty"; difficulty: Difficulty }
  | { type: "setRuleTuning"; tuning: RuleTuning | null }
  | { type: "continueSandbox" }
  | { type: "claimState"; stateId: string }
  | { type: "queueConstruction"; countryId: string; stateId: string; good: Building; privateBuild?: boolean }
  | { type: "advanceTick" | "advanceWeek" | "advanceDay" | "advanceHalfYear" }
  | PoliticsCommand
  | BorderCommand;

export function createGame(scenario: Scenario, seed = 1820, difficulty: Difficulty = "standard", campaign?: CampaignSetup): GameState {
  const social = initSociety(scenario),
    countries = Object.values(scenario.countries),
    owned = Object.values(scenario.states).filter((s) => s.ownerId !== null);
  // One pioneer per category. Seeded starting knowledge is a scenario balance assumption.
  if (countries.length >= 3)
    techs.slice(0, 3).forEach((tech, i) => {
      social.nations[countries[(seed + i) % countries.length].id].knowledge[tech] = 100;
    });
  return {
    elapsedDays: 0,
    tickInDay: 0,
    settings: initialSettings(difficulty),
    playerCountryId: null,
    rng: seed >>> 0,
    ...social,
    lastEconomy: null,
    lastPopulation: null,
    ...(campaign ? { campaign: startCampaign(campaign) } : {}),
    borderDispute: null,
    ownerByStateId: Object.fromEntries(owned.map((s) => [s.id, s.ownerId!])),
    stateEconomies: Object.fromEntries(
      owned.map((s) => [
        s.id,
        { population: s.population, buildings: { ...s.buildings } },
      ]),
    ),
    countryEconomies: Object.fromEntries(
      countries.map((c) => [c.id, { treasury: openingReserve(c.treasury, difficulty), queue: [] }]),
    ),
  };
}
export const DAY_MS = 86400000;
export const TICKS_PER_DAY = 4;
export function elapsedTicks(state: GameState) {
  return state.elapsedDays * TICKS_PER_DAY + state.tickInDay;
}

export function getGameDate(scenario: Scenario, state: GameState) {
  return new Date(Date.parse(scenario.startDate) + DAY_MS * state.elapsedDays);
}
export function isPopulationMonth(scenario: Scenario, state: GameState) {
  return state.tickInDay === 0 && state.elapsedDays > 0 && getGameDate(scenario, state).getUTCDate() === 1;
}
function remainingDays(scenario: Scenario, state: GameState) {
  if (state.campaign?.sandbox) return Infinity;
  if (state.campaign?.ending) return 0;
  const deadline = campaignEndDate(scenario, state);
  if (deadline === undefined) return Infinity;
  return Math.max(0, (Date.parse(deadline) - getGameDate(scenario, state).getTime()) / DAY_MS);
}
export function campaignEndDate(scenario: Scenario, state: GameState) {
  return state.campaign ? `${state.campaign.endYear}-01-01` : scenario.endDate;
}
export function isScenarioFinished(scenario: Scenario, state: GameState) {
  return remainingDays(scenario, state) === 0;
}
export function spanDays(scenario: Scenario, state: GameState, span: Span) {
  const remaining = remainingDays(scenario, state);
  if (remaining === 0) return 0;
  if (span !== "halfYear") return Math.min(remaining, span === "day" ? 1 : 7);
  const date = getGameDate(scenario, state);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 7, 0));
  end.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return Math.min(remaining, (end.getTime() - date.getTime()) / DAY_MS);
}
export function advanceDay(
  scenario: Scenario,
  state: GameState,
  humanCountries: ReadonlySet<string | null> = new Set([state.playerCountryId]),
): GameState {
  for (let i = 0; i < TICKS_PER_DAY; i++) state = advanceTick(scenario, state, humanCountries);
  return state;
}

export function advanceTick(
  scenario: Scenario,
  state: GameState,
  humanCountries: ReadonlySet<string | null> = new Set([state.playerCountryId]),
): GameState {
  if (isScenarioFinished(scenario, state)) return state;
  const tickInDay = state.tickInDay + 1;
  if (tickInDay < TICKS_PER_DAY) return { ...state, tickInDay };
  const next = tickDiplomacy(scenario, { ...state, elapsedDays: state.elapsedDays + 1, tickInDay: 0 });
  const date = getGameDate(scenario, next);
  const monthly = isPopulationMonth(scenario, next);
  if (next.elapsedDays % 7 !== 0) {
    const result = monthly ? settlePopulationMonth(scenario, next, date) : next;
    return finalizeCampaign(result, date, result.ownerByStateId !== state.ownerByStateId);
  }
  const yearFraction = fiscalWeekFraction(date);
  const weekly = settleEconomy(next, planWar(scenario, next), yearFraction);
  const settled = monthly ? settlePopulationMonth(scenario, weekly, date) : weekly;
  let result = advancePolitics(advanceFront(scenario, settled, settled.lastEconomy), settled.lastEconomy, date.getUTCFullYear(), yearFraction);
  result.rng = (Math.imul(result.rng, 1664525) + 1013904223) >>> 0;
  const owners = new Set(Object.values(result.ownerByStateId));
  for (const id of owners) {
    const { market } = settled.lastEconomy.countries[id];
    if (!humanCountries.has(id)) {
      const job = chooseConstruction(scenario, result, id, market) ?? chooseUniversity(scenario, result, id);
      if (job) result = applyCommand(scenario, result, { type: "queueConstruction", countryId: id, ...job });
      const n = result.nations[id];
      const pending = techs.filter((t) => availableTech(n, t));
      if (!n.research && pending.length)
        result = applyCommand(scenario, result, {
          type: "startResearch",
          countryId: id,
          tech: pending[(result.rng + hash(id)) % pending.length],
        });
      if (!n.reform && !n.laws.includes("普选制")) {
        const cmd = { type: "proposeLaw", countryId: id, law: "普选制" } as const;
        if (!politicsError(result, cmd)) result = applyCommand(scenario, result, cmd);
      }
    }
    const job = chooseConstruction(scenario, result, id, market, true);
    if (job)
      result = applyCommand(scenario, result, {
        type: "queueConstruction",
        countryId: id,
        privateBuild: true,
        ...job,
      });
  }
  for (const cmd of aiDiplomacy(scenario, result, humanCountries)) result = applyCommand(scenario, result, cmd);
  return finalizeCampaign(result, date, result.ownerByStateId !== state.ownerByStateId);
}
export function dispatch(scenario: Scenario, state: GameState, cmd: GameCommand): GameState {
  switch (cmd.type) {
    case "continueSandbox":
      if (state.campaign?.ending?.kind !== "neutral" || state.campaign.sandbox)
        throw new GameRuleError("当前无法继续沙盒");
      return { ...state, campaign: { ...state.campaign, sandbox: true } };
    case "advanceTick":
      if (!state.playerCountryId) throw new GameRuleError("请先选择国家");
      return advanceTick(scenario, state);
    case "advanceDay":
    case "advanceWeek":
    case "advanceHalfYear": {
      if (!state.playerCountryId) throw new GameRuleError("请先选择国家");
      const days = spanDays(
        scenario,
        state,
        cmd.type === "advanceDay" ? "day" : cmd.type === "advanceWeek" ? "week" : "halfYear",
      );
      for (let i = 0; i < days; i++) state = advanceDay(scenario, state);
      return state;
    }
    default:
      if (isScenarioFinished(scenario, state)) throw new GameRuleError("剧本已结束");
      const next = applyCommand(scenario, state, cmd);
      return next.ownerByStateId === state.ownerByStateId ? next : finalizeCampaign(next, getGameDate(scenario, next), true);
  }
}
function applyCommand(
  scenario: Scenario,
  state: GameState,
  cmd: Exclude<GameCommand, { type: "advanceTick" | "advanceWeek" | "advanceDay" | "advanceHalfYear" | "continueSandbox" }>,
): GameState {
  if (cmd.type === "selectCountry") {
    if (state.playerCountryId !== null || !Object.hasOwn(scenario.countries, cmd.countryId) ||
        scenario.countries[cmd.countryId].selectable === false)
      throw new GameRuleError("无法选择这个国家");
    return { ...state, playerCountryId: cmd.countryId };
  }
  if (!state.playerCountryId) throw new GameRuleError("请先选择国家");
  switch (cmd.type) {
    case "setDifficulty": {
      const settings = changeDifficulty(state.settings, cmd.difficulty, elapsedTicks(state));
      return settings === state.settings ? state : { ...state, settings };
    }
    case "setRuleTuning":
      return { ...state, settings: { ...state.settings, tuning: cmd.tuning } };
    case "claimState":
      return applyClaim(scenario, state, cmd.stateId);
    case "queueConstruction": {
      const { countryId: id, stateId, good, privateBuild } = cmd;
      const error = constructionError(scenario, state, id, stateId, good, privateBuild);
      if (error) throw new GameRuleError(error);
      const { cost, weeks } = projects[good],
        job = { stateId, good, weeksLeft: weeks };
      if (privateBuild && (good === "grain" || good === "cloth")) {
        const n = state.nations[id];
        return {
          ...state,
          nations: {
            ...state.nations,
            [id]: {
              ...n,
              investment: n.investment - cost,
              privateQueue: [...n.privateQueue, { ...job, good }],
            },
          },
        };
      }
      const c = state.countryEconomies[id];
      return {
        ...state,
        countryEconomies: {
          ...state.countryEconomies,
          [id]: { ...c, treasury: c.treasury - cost, queue: [...c.queue, job] },
        },
      };
    }
    case "setGovernment":
    case "proposeLaw":
    case "startResearch":
      return applyPolitics(state, cmd);
    default:
      return applyBorderCommand(scenario, state, cmd);
  }
}
