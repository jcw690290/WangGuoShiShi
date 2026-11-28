import { z } from "zod";
import { GameRuleError } from "./rules.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { isScenarioFinished } from "./engine.ts";
import type { GameState } from "./engine.ts";
import { initSiteSociety } from "./society.ts";
import type { Pop } from "./society.ts";
import { governanceModeAllowed, newFrontier } from "./governance.ts";
import { initialStateEconomy } from "./economy.ts";
import type { EconomyReport } from "./economy.ts";
import { influenceBudget } from "./foreign-relations.ts";
import { seaVoyageCargoCost } from "./transport.ts";
import { effectiveConvoyCapacity } from "./fleet.ts";

// Demo balance parameter, in the same internal silver units as construction.
export const CLAIM_COST = 50_000;
export const territoryType = (scenario: Scenario, state: GameState, stateId: string) =>
  Object.hasOwn(state.ownerByStateId, stateId) ? "STATE_OWNED" : scenario.states[stateId].unownedStatus ?? "UNCLAIMED";
const settlementModes = ["FRONTIER", "COLONIAL", "INDIRECT"] as const;
export const territorialSettlementSchema = z.object({
  stateId: z.string(), countryId: z.string(), anchorId: z.string(), mode: z.enum(settlementModes),
  sea: z.boolean(), startedDay: z.int().nonnegative(), progress: z.number().min(0).lt(1),
}).refine((project) => project.stateId !== project.anchorId &&
  (project.mode === "INDIRECT" || project.sea === (project.mode === "COLONIAL")));
export type TerritorialSettlement = z.infer<typeof territorialSettlementSchema>;
export type TerritorialSettlementCommand =
  | { type: "claimState"; stateId: string; countryId?: string }
  | { type: "cancelTerritorialSettlement"; stateId: string; countryId: string };
export const settlementAt = (state: GameState, stateId: string) =>
  state.territorialSettlements?.find((project) => project.stateId === stateId);
export const territorialClaimSchema = z.object({
  stateId: z.string(), claimantId: z.string(), declaredDay: z.int().nonnegative(), recognizedBy: z.array(z.string()),
}).refine((claim) => !claim.recognizedBy.includes(claim.claimantId) &&
  new Set(claim.recognizedBy).size === claim.recognizedBy.length);
export type TerritorialClaim = z.infer<typeof territorialClaimSchema>;
export type TerritorialClaimCommand = {
  type: "declareTerritorialClaim" | "renounceTerritorialClaim"; stateId: string; countryId: string;
};

export const territorialClaim = (state: GameState, countryId: string, stateId: string) =>
  state.territorialClaims?.find((claim) => claim.claimantId === countryId && claim.stateId === stateId);

export function territorialClaimError(scenario: Scenario, state: GameState, cmd: TerritorialClaimCommand) {
  const { countryId, stateId } = cmd;
  const claim = territorialClaim(state, countryId, stateId);
  if (cmd.type === "renounceTerritorialClaim") {
    if (!claim) return "本国没有登记该宣称";
    const dispute = state.borderDispute;
    if (dispute && dispute.phase !== "resolved" && dispute.claimantId === countryId && dispute.targetStateId === stateId &&
        dispute.goals.includes("recognition")) return "进行中的承认条款需要保留该宣称";
    return;
  }
  const site = scenario.states[stateId];
  if (!site || state.ownerByStateId[stateId] === countryId) return "请选择尚未归属本国的州";
  if (claim) return "本国已经声明该领土";
  if (!Object.values(state.ownerByStateId).includes(countryId) || state.nations[countryId].overlord)
    return "只有独立且拥有领土的国家可宣称";
  const adjacent = site.neighbors.some((id) => state.ownerByStateId[id] === countryId);
  const overseas = site.coastal && Object.values(scenario.states)
    .some((port) => port.coastal && state.ownerByStateId[port.id] === countryId && state.occupation?.stateId !== port.id);
  if (!adjacent && !overseas) return "需要陆地接壤或沿海通达";
  if (influenceBudget(state, countryId).available < 1) return "可用外交影响力不足";
}

export function applyTerritorialClaim(scenario: Scenario, state: GameState, cmd: TerritorialClaimCommand): GameState {
  const problem = territorialClaimError(scenario, state, cmd);
  if (problem) throw new GameRuleError(problem);
  const { countryId, stateId } = cmd;
  const claims = state.territorialClaims ?? [];
  const territorialClaims = cmd.type === "declareTerritorialClaim"
    ? [...claims, { claimantId: countryId, stateId, declaredDay: state.elapsedDays, recognizedBy: [] }]
    : claims.filter((claim) => claim.claimantId !== countryId || claim.stateId !== stateId);
  return { ...state, territorialClaims };
}

export function recognizeTerritorialClaim(state: GameState, claimantId: string, recognizer: string, stateId: string) {
  const claim = territorialClaim(state, claimantId, stateId)!;
  const recognized = { ...claim, recognizedBy: [...claim.recognizedBy, recognizer] };
  return {
    ...state,
    territorialClaims: state.territorialClaims!.map((row) => row === claim ? recognized : row),
  };
}

export function reconcileTerritorialPlans(state: GameState): GameState {
  if (!state.territorialClaims && !state.territorialSettlements) return state;
  const live = new Set(Object.values(state.ownerByStateId));
  const territorialClaims = state.territorialClaims
    ?.filter((claim) => live.has(claim.claimantId) && state.ownerByStateId[claim.stateId] !== claim.claimantId)
    .map((claim) => ({ ...claim, recognizedBy: claim.recognizedBy.filter((id) => live.has(id)) }));
  const territorialSettlements = state.territorialSettlements
    ?.filter((project) => live.has(project.countryId) && !Object.hasOwn(state.ownerByStateId, project.stateId));
  return { ...state, ...(territorialClaims ? { territorialClaims } : {}),
    ...(territorialSettlements ? { territorialSettlements } : {}) };
}

function anchorFor(scenario: Scenario, state: GameState, stateId: string, countryId: string) {
  const target = scenario.states[stateId];
  const candidates = Object.values(scenario.states).filter((site) => state.ownerByStateId[site.id] === countryId &&
    state.occupation?.stateId !== site.id && state.societies[site.id].bureaucracy > 0);
  const best = candidates.sort((a, b) => state.societies[b.id].bureaucracy - state.societies[a.id].bureaucracy ||
    state.stateEconomies[b.id].population - state.stateEconomies[a.id].population);
  const land = best.find((site) => target.neighbors.includes(site.id));
  if (land) return { anchorId: land.id, sea: false };
  const port = target.coastal && best.find((site) => site.coastal && seaVoyageCargoCost(site.label, target.label) <= 2);
  if (port) return { anchorId: port.id, sea: true };
}

const settlementMode = (scenario: Scenario, state: GameState, stateId: string, sea: boolean) =>
  territoryType(scenario, state, stateId) === "LOCAL_POLITY" ? "INDIRECT" : sea ? "COLONIAL" : "FRONTIER";

export function claimError(scenario: Scenario, state: GameState, stateId: string, countryId = state.playerCountryId) {
  if (countryId === null) return "请先选择国家";
  if (isScenarioFinished(scenario, state)) return "剧本已结束";
  if (!Object.hasOwn(scenario.states, stateId)) return "不存在这个州";
  if (Object.hasOwn(state.ownerByStateId, stateId)) return "只能在未分配地区开展领土项目";
  if (settlementAt(state, stateId)) return "这里已有进行中的领土项目";
  if (!Object.values(state.ownerByStateId).includes(countryId) || state.nations[countryId].overlord)
    return "只有拥有领土的独立国家可以启动";
  if (state.countryEconomies[countryId].treasury < CLAIM_COST) return "国库资金不足";
  const anchor = anchorFor(scenario, state, stateId, countryId);
  if (!anchor) return "需要接壤州或航程内港口提供行政支持";
  const mode = settlementMode(scenario, state, stateId, anchor.sea);
  if (!governanceModeAllowed(mode, state.nations[countryId].laws)) return "地方治理法律不允许该项目";
}

export function applyTerritorialSettlement(scenario: Scenario, state: GameState, cmd: TerritorialSettlementCommand): GameState {
  const { stateId } = cmd;
  const countryId = cmd.countryId ?? state.playerCountryId;
  if (cmd.type === "cancelTerritorialSettlement") {
    const project = settlementAt(state, stateId);
    if (!project || project.countryId !== countryId) throw new GameRuleError("没有可取消的本国领土项目");
    return { ...state, territorialSettlements: state.territorialSettlements!.filter((item) => item !== project) };
  }
  const error = claimError(scenario, state, stateId, countryId);
  if (error) throw new GameRuleError(error);
  const id = countryId!, anchor = anchorFor(scenario, state, stateId, id)!;
  const mode = settlementMode(scenario, state, stateId, anchor.sea);
  const country = state.countryEconomies[id];
  return { ...state, countryEconomies: { ...state.countryEconomies, [id]: { ...country, treasury: country.treasury - CLAIM_COST } },
    territorialSettlements: [...(state.territorialSettlements ?? []), {
      stateId, countryId: id, ...anchor, mode, startedDay: state.elapsedDays, progress: 0,
    }] };
}

function completeSettlement(scenario: Scenario, state: GameState, project: TerritorialSettlement): GameState {
  const { countryId, anchorId, stateId, mode } = project;
  const template = scenario.states[stateId];
  const origin = state.stateEconomies[anchorId];
  const local = initialStateEconomy(template);
  const society = initSiteSociety(template);
  const receiving: Pop[] = [...society.pops];
  const movers = mode === "INDIRECT" ? 0 : Math.min(500, Math.floor(origin.population / 100));
  let people = 0, moved = 0;
  const remaining = movers === 0 ? state.societies[anchorId].pops : state.societies[anchorId].pops.map((pop) => {
    people += pop.people;
    const cumulative = Math.floor(movers * people / origin.population);
    const arrivals = cumulative - moved;
    moved = cumulative;
    const match = receiving.findIndex((row) => row.occupation === pop.occupation && row.culture === pop.culture && row.religion === pop.religion);
    if (match === -1) receiving.push({ ...pop, people: arrivals });
    else if (arrivals > 0) {
      const prior = receiving[match], total = prior.people + arrivals;
      receiving[match] = {
        ...prior, people: total,
        wealth: (prior.wealth * prior.people + pop.wealth * arrivals) / total,
        literacy: (prior.literacy * prior.people + pop.literacy * arrivals) / total,
        radicals: (prior.radicals * prior.people + pop.radicals * arrivals) / total,
        livingStandard: (prior.livingStandard * prior.people + pop.livingStandard * arrivals) / total,
      };
    }
    return { ...pop, people: pop.people - arrivals };
  });
  const budget = Math.floor(origin.basicBudget * movers / origin.population);
  const extras = Math.floor((origin.discretionaryBudget ?? 0) * movers / origin.population);
  return {
    ...state,
    ownerByStateId: { ...state.ownerByStateId, [stateId]: countryId },
    stateEconomies: { ...state.stateEconomies,
      [anchorId]: { ...origin, population: origin.population - movers, basicBudget: origin.basicBudget - budget,
        discretionaryBudget: (origin.discretionaryBudget ?? 0) - extras },
      [stateId]: { ...local, population: local.population + movers, basicBudget: local.basicBudget + budget, discretionaryBudget: extras },
    },
    societies: { ...state.societies,
      [anchorId]: { ...state.societies[anchorId], pops: remaining },
      [stateId]: { ...society, pops: receiving, governance: { ...newFrontier, mode } },
    },
    lastEconomy: null,
  };
}

export function advanceTerritorialSettlements(scenario: Scenario, state: GameState, report: EconomyReport) {
  if (!state.territorialSettlements?.length) return state;
  const uncompleted: TerritorialSettlement[] = [];
  const staffUsed = new Map<string, number>(), cargoUsed = new Map<string, number>();
  let next = state;
  for (const project of state.territorialSettlements) {
    const { countryId, anchorId, stateId, mode, sea, startedDay } = project;
    const laws = state.nations[countryId].laws;
    if (state.ownerByStateId[anchorId] !== countryId || state.occupation?.stateId === anchorId ||
        !governanceModeAllowed(mode, laws) || state.elapsedDays === startedDay) {
      uncompleted.push(project);
      continue;
    }
    const coverage = report.states[anchorId].office!.coverage;
    const staff = Math.max(0, coverage - (staffUsed.get(anchorId) ?? 0));
    const military = report.countries[countryId].military.seaCargoUsed ?? 0;
    const trade = report.countries[countryId].tradeSeaCargo ?? 0;
    const spare = Math.max(0, effectiveConvoyCapacity(state.nations[countryId]) -
      military - trade - (cargoUsed.get(countryId) ?? 0));
    const access = sea ? Math.min(1, spare / 200) : 1;
    const week = Math.min(1, (state.elapsedDays - startedDay) / 7);
    const effort = staff * access * week;
    staffUsed.set(anchorId, (staffUsed.get(anchorId) ?? 0) + effort);
    if (sea) cargoUsed.set(countryId, (cargoUsed.get(countryId) ?? 0) + 200 * effort);
    const rival = state.territorialClaims?.some((claim) => claim.stateId === stateId && claim.claimantId !== countryId);
    const duration = mode === "INDIRECT" ? 9 : sea ? 10 : 6;
    const progress = project.progress + effort * (rival ? 0.5 : 1) / duration;
    if (progress < 1 - 1e-9) uncompleted.push({ ...project, progress });
    else next = completeSettlement(scenario, next, project);
  }
  return reconcileTerritorialPlans({ ...next, territorialSettlements: uncompleted });
}

export function chooseTerritorialSettlement(scenario: Scenario, state: GameState, countryId: string): TerritorialSettlementCommand | undefined {
  if (state.elapsedDays % 91 !== 0 || state.countryEconomies[countryId].treasury < CLAIM_COST * 4 ||
      state.territorialSettlements?.some((project) => project.countryId === countryId)) return;
  const candidate = Object.values(scenario.states).find((site) => !Object.hasOwn(state.ownerByStateId, site.id) &&
    site.neighbors.some((id) => state.ownerByStateId[id] === countryId) && !claimError(scenario, state, site.id, countryId));
  if (candidate) return { type: "claimState", stateId: candidate.id, countryId };
}
