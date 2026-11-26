import { GameRuleError } from "./rules.ts";
import { changeDifficulty, initialSettings, openingReserve } from "./settings.ts";
import type { Difficulty, GameSettings, RuleTuning } from "./settings.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { advanceFront, aiDiplomacy, applyBorderCommand, planWar, tickDiplomacy } from "./diplomacy.ts";
import type { BorderCommand, BorderDispute } from "./diplomacy.ts";
import { chooseConstruction, choosePort, chooseRailway, chooseUniversity, constructionError,
  initialStateEconomy, projectDeposit, projectOpeningCapital, projects, settleEconomy } from "./economy.ts";
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
import type { DiplomaticTie } from "./diplomatic-ties.ts";
import { applyGovernanceCommand, chooseIntegration } from "./governance.ts";
import type { GovernanceCommand } from "./governance.ts";
import { DAY_MS, elapsedTicks, TICKS_PER_DAY } from "./time.ts";
import { applyTradeCommand } from "./trade.ts";
import type { TradeCommand, TradeRoute } from "./trade.ts";
import { advanceAchievements } from "./achievements.ts";
import { chooseLocalNegotiation, negotiateLocalUnrest } from "./unrest.ts";
import type { LocalUnrestCommand } from "./unrest.ts";
import { industries, isGood } from "./industry.ts";
import { effectiveConvoyCapacity, maxConvoyOrder, shipGoodsPerConvoy } from "./fleet.ts";
export { DAY_MS, elapsedTicks, TICKS_PER_DAY } from "./time.ts";

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
  diplomaticTies?: DiplomaticTie[];
  tradeRoutes?: TradeRoute[];
  occupation?: Occupation;
}
export type Span = "day" | "week" | "halfYear";
export type GameCommand =
  | { type: "selectCountry"; countryId: string }
  | { type: "setDifficulty"; difficulty: Difficulty }
  | { type: "setRuleTuning"; tuning: RuleTuning | null }
  | { type: "continueSandbox" }
  | { type: "settleCampaignVictory" }
  | { type: "claimState"; stateId: string }
  | { type: "queueConstruction"; countryId: string; stateId: string; good: Building; privateBuild?: boolean }
  | { type: "cancelConstruction"; countryId: string; index: number; stateId: string; good: Building; privateBuild?: boolean }
  | { type: "setConvoyOrder"; countryId: string; stateId: string; operation: "add" | "move" | "cancel" }
  | { type: "advanceTick" | "advanceWeek" | "advanceDay" | "advanceHalfYear" }
  | PoliticsCommand
  | GovernanceCommand
  | TradeCommand
  | LocalUnrestCommand
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
    ...(scenario.diplomaticTies ? { diplomaticTies: scenario.diplomaticTies.map((tie) => ({ ...tie })) } : {}),
    ownerByStateId: Object.fromEntries(owned.map((s) => [s.id, s.ownerId!])),
    stateEconomies: Object.fromEntries(
      owned.map((s) => [
        s.id,
        initialStateEconomy(s),
      ]),
    ),
    countryEconomies: Object.fromEntries(
      countries.map((c) => [c.id, { treasury: openingReserve(c.treasury, difficulty), queue: [] }]),
    ),
  };
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
    return finalizeCampaign(scenario, advanceAchievements(state, result, date), date,
      monthly || result.borderDispute !== state.borderDispute || result.ownerByStateId !== state.ownerByStateId);
  }
  const yearFraction = fiscalWeekFraction(date);
  const weekly = settleEconomy(next, planWar(scenario, next), yearFraction, scenario);
  const settled = monthly ? settlePopulationMonth(scenario, weekly, date) : weekly;
  let result = advancePolitics(advanceFront(scenario, settled, settled.lastEconomy), settled.lastEconomy, date.getUTCFullYear(), yearFraction);
  result.rng = (Math.imul(result.rng, 1664525) + 1013904223) >>> 0;
  const owners = new Set(Object.values(result.ownerByStateId));
  for (const id of owners) {
    const { market } = settled.lastEconomy.countries[id];
    if (!humanCountries.has(id)) {
      const job = chooseUniversity(scenario, result, id) ?? chooseRailway(scenario, result, id, settled.lastEconomy) ??
        choosePort(scenario, result, id, settled.lastEconomy) ?? chooseConstruction(scenario, result, id, market);
      if (result.elapsedDays % 28 === 0) {
        const integration = chooseIntegration(result, id);
        if (integration) result = applyGovernanceCommand(result, integration);
        const agreement = chooseLocalNegotiation(result, id);
        if (agreement) result = negotiateLocalUnrest(result, agreement);
      }
      if (job) result = applyCommand(scenario, result, { type: "queueConstruction", countryId: id, ...job });
      const report = settled.lastEconomy.countries[id];
      const port = report.fleet?.port;
      const occupiedCargo = (report.military.seaCargoUsed ?? 0) + (report.tradeSeaCargo ?? 0);
      if (result.elapsedDays % 28 === 0 && port && result.occupation?.stateId !== port && !result.nations[id].fleet.order &&
          occupiedCargo > 0 && occupiedCargo >= effectiveConvoyCapacity(next.nations[id]) * 0.8 &&
          result.countryEconomies[id].treasury >= shipGoodsPerConvoy * industries.shipGoods.basePrice * 1.75) {
        result = applyCommand(scenario, result, { type: "setConvoyOrder", countryId: id, stateId: port, operation: "add" });
      }
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
  return finalizeCampaign(scenario, advanceAchievements(state, result, date, settled.lastEconomy), date, true);
}
export function dispatch(scenario: Scenario, state: GameState, cmd: GameCommand): GameState {
  switch (cmd.type) {
    case "continueSandbox":
      if (!state.campaign?.ending || state.campaign.ending.kind === "extinct" || state.campaign.sandbox)
        throw new GameRuleError("当前无法继续沙盒");
      return { ...state, campaign: { ...state.campaign, sandbox: true } };
    case "settleCampaignVictory":
      return finalizeCampaign(scenario, state, getGameDate(scenario, state), true, true);
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
      const date = getGameDate(scenario, next);
      const awarded = advanceAchievements(state, next, date);
      return finalizeCampaign(scenario, awarded, date, true);
  }
}
function applyCommand(
  scenario: Scenario,
  state: GameState,
  cmd: Exclude<GameCommand, { type: "advanceTick" | "advanceWeek" | "advanceDay" | "advanceHalfYear" | "continueSandbox" | "settleCampaignVictory" }>,
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
    case "setLocalGovernance":
    case "startIntegration":
    case "cancelIntegration":
      return applyGovernanceCommand(state, cmd);
    case "openTradeRoute":
    case "setTradeRoute":
    case "removeTradeRoute":
      return applyTradeCommand(scenario, state, cmd);
    case "negotiateLocalUnrest":
      return negotiateLocalUnrest(state, cmd);
    case "queueConstruction": {
      const { countryId: id, stateId, good, privateBuild } = cmd;
      const error = constructionError(scenario, state, id, stateId, good, privateBuild);
      if (error) throw new GameRuleError(error);
      const cost = projectDeposit(good), { weeks } = projects[good],
        job = { stateId, good, weeksLeft: weeks };
      if (privateBuild && isGood(good)) {
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
    case "cancelConstruction": {
      const { countryId: id, index, stateId, good, privateBuild } = cmd;
      const c = state.countryEconomies[id], n = state.nations[id];
      const queue = privateBuild ? n.privateQueue : c.queue;
      const job = queue[index];
      if (!job || job.stateId !== stateId || job.good !== good) throw new GameRuleError("该工程已不在队列中");
      const returned = projectOpeningCapital(job);
      if (privateBuild) return {
        ...state,
        nations: { ...state.nations, [id]: {
          ...n, investment: n.investment + returned, privateQueue: n.privateQueue.filter((_, i) => i !== index),
        } },
      };
      return {
        ...state,
        countryEconomies: { ...state.countryEconomies, [id]: {
          ...c, treasury: c.treasury + returned, queue: c.queue.filter((_, i) => i !== index),
        } },
      };
    }
    case "setConvoyOrder": {
      const { countryId: id, stateId, operation } = cmd;
      if (state.ownerByStateId[stateId] !== id || !scenario.states[stateId]?.coastal)
        throw new GameRuleError("只能在本国沿海州安排商船");
      if (operation !== "cancel" && state.occupation?.stateId === stateId) throw new GameRuleError("该港口处于军事占领中");
      const nation = state.nations[id];
      const current = nation.fleet.order;
      if (operation === "move" && current === null || operation === "cancel" && current?.stateId !== stateId)
        throw new GameRuleError("该商船订单已变更");
      if (operation === "add" && current && (current.stateId !== stateId || current.remaining >= maxConvoyOrder))
        throw new GameRuleError("请检查订单所在港口和数量上限");
      const order = operation === "cancel" ? null :
        { stateId, remaining: (current?.remaining ?? 0) + (operation === "add" ? 1 : 0) };
      return { ...state, nations: { ...state.nations, [id]: { ...nation, fleet: { ...nation.fleet, order } } } };
    }
    case "setGovernment":
    case "proposeLaw":
    case "startResearch":
      return applyPolitics(state, cmd);
    default:
      return applyBorderCommand(scenario, state, cmd);
  }
}
