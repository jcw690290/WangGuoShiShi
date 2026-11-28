import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import { constitutionalLaws, constitutionLawCategory } from "./constitution.ts";
import { constitutionalCrisisWarning, constitutionalSupportByState, compromiseDays } from "./constitutional-crises.ts";
import type { BorderDispute } from "./diplomacy.ts";
import type { CountryEconomy } from "./economy.ts";
import type { GameState } from "./engine.ts";
import type { FiscalAccount } from "./fiscal.ts";
import { GameRuleError } from "./rules.ts";
import { supporters, type Nation } from "./society.ts";

export const civilSides = ["government", "opposition"] as const;
const civilSide = z.enum(civilSides);
const countryId = z.string().min(1);
const day = z.int().nonnegative();
export const civilWarEscalationDays = 84;
const civilWarLimitDays = 728;

export const civilWarSchema = z.strictObject({
  countryId,
  demand: z.enum(constitutionalLaws),
  side: civilSide.nullable(),
});
export const civilWarResultSchema = civilWarSchema.omit({ side: true }).extend({
  winner: civilSide,
  endedDay: day,
});
type CivilSide = z.infer<typeof civilSide>;
export type CivilWar = z.infer<typeof civilWarSchema>;
export type CivilWarResult = z.infer<typeof civilWarResultSchema>;
export type CivilWarCommand = { type: "chooseCivilWarSide"; countryId: string; side: CivilSide };

export const oppositionId = (id: string) => "civil_" + id;

export function scenarioWithCivilWar(scenario: Scenario, civilWar: CivilWar | undefined): Scenario {
  if (!civilWar) return scenario;
  const id = oppositionId(civilWar.countryId);
  const parent = scenario.countries[civilWar.countryId];
  return {
    ...scenario,
    countries: { ...scenario.countries, [id]: { id, name: parent.name + "反对派", color: "#9e5268", treasury: 0, selectable: false } },
  };
}

export function controlledCivilCountry(state: GameState, seat: string) {
  return state.civilWar?.countryId === seat && state.civilWar.side === "opposition" ? oppositionId(seat) : seat;
}

export function mustChooseCivilSide(state: GameState, seat: string | null) {
  return !!state.civilWar && state.civilWar.countryId === seat && state.civilWar.side === null;
}

export function chooseCivilWarSide(state: GameState, command: CivilWarCommand): GameState {
  const { civilWar } = state;
  if (state.playerCountryId !== command.countryId || !civilWar || civilWar.countryId !== command.countryId ||
      civilWar.side !== null || !civilSide.safeParse(command.side).success) throw new GameRuleError("当前无法选择内战阵营");
  return { ...state, civilWar: { ...civilWar, side: command.side } };
}

function apportionedFiscal(fiscal: FiscalAccount, take: (value: number) => number): FiscalAccount {
  const { week } = fiscal;
  return {
    debt: take(fiscal.debt), arrears: take(fiscal.arrears), taxHistory: fiscal.taxHistory.map(take),
    week: {
      ...week, creditLimit: take(week.creditLimit), borrowed: take(week.borrowed), repaid: take(week.repaid),
      interestDue: take(week.interestDue), interestPaid: take(week.interestPaid),
      upkeepDue: take(week.upkeepDue), upkeepPaid: take(week.upkeepPaid),
    },
  };
}

function supportSplit(scenario: Scenario, state: GameState, country: string, demand: CivilWar["demand"]) {
  const support = constitutionalSupportByState(state, country, demand);
  const government = new Set(support.map(({ stateId }) => stateId));
  const opposition = new Set<string>();
  // Preserve a reachable front between the two groups, including disconnected coastal holdings.
  const provincesTouch = (a: string, b: string) => scenario.states[a].neighbors.includes(b) ||
    (scenario.states[a].coastal && scenario.states[b].coastal);
  for (const { stateId, opposition: backing } of support) {
    if (government.size === 1 || (opposition.size > 0 && backing < 50)) break;
    if (opposition.size && ![...opposition].some((other) => provincesTouch(other, stateId))) continue;
    if (![...government].some((other) => other !== stateId && provincesTouch(other, stateId))) continue;
    government.delete(stateId);
    opposition.add(stateId);
  }
  const front = [...government].find((id) => [...opposition].some((other) => scenario.states[id].neighbors.includes(other))) ??
    [...government].find((id) => [...opposition].some((other) => provincesTouch(id, other)));
  return front ? { opposition, front } : undefined;
}

function startCivilWar(scenario: Scenario, state: GameState, id: string, demand: CivilWar["demand"]) {
  const split = supportSplit(scenario, state, id, demand);
  if (!split) return state;
  const { opposition: sites, front } = split;
  const rebel = oppositionId(id);
  const ownerByStateId = { ...state.ownerByStateId };
  for (const site of sites) ownerByStateId[site] = rebel;
  const total = Object.keys(state.ownerByStateId).filter((site) => state.ownerByStateId[site] === id);
  const totalPopulation = total.reduce((sum, site) => sum + state.stateEconomies[site].population, 0);
  const population = [...sites].reduce((sum, site) => sum + state.stateEconomies[site].population, 0);
  const ports = total.filter((site) => scenario.states[site].coastal);
  const portFraction = ports.length ? ports.filter((site) => sites.has(site)).length / ports.length : 0;
  const share = (value: number) => Math.floor(value * population / totalPopulation);
  const coastalShare = (value: number) => Math.floor(value * portFraction);
  const economy = state.countryEconomies[id], nation = state.nations[id];
  const partition = (reformSide: boolean) => {
    const owns = (site: string) => sites.has(site) === reformSide;
    const amount = reformSide ? share : (value: number) => value - share(value);
    const maritime = reformSide ? coastalShare : (value: number) => value - coastalShare(value);
    const { fleet, navy } = nation;
    const assigned: Nation = {
      ...nation,
      privateQueue: nation.privateQueue.filter((project) => owns(project.stateId)),
      investment: amount(nation.investment),
      government: reformSide ? supporters[demand].filter((group) => !nation.government.includes(group)) : nation.government,
      reform: nation.reform === demand ? null : nation.reform,
      reformProgress: nation.reform === demand ? 0 : nation.reformProgress,
      ...(reformSide && {
        interests: [], tradePartners: [], overlord: null, marketLeader: null, subjectType: null, prestige: 0, infamy: 0,
      }),
      convoys: maritime(nation.convoys),
      fleet: {
        ...fleet, stores: maritime(fleet.stores), oil: maritime(fleet.oil), rubber: maritime(fleet.rubber),
        motorized: maritime(fleet.motorized), fueled: maritime(fleet.fueled),
        order: fleet.order && owns(fleet.order.stateId) ? fleet.order : null,
        motorizationPort: fleet.motorizationPort !== null && owns(fleet.motorizationPort) ? fleet.motorizationPort : null,
      },
      navy: {
        ...navy, warships: maritime(navy.warships), armored: maritime(navy.armored), stores: maritime(navy.stores),
        order: navy.order && owns(navy.order.stateId) ? navy.order : null,
      },
    };
    const budget: CountryEconomy = {
      ...economy,
      treasury: amount(economy.treasury),
      fiscal: economy.fiscal && apportionedFiscal(economy.fiscal, amount),
      queue: economy.queue.filter((project) => owns(project.stateId)),
      industrySubsidies: economy.industrySubsidies &&
        Object.fromEntries(Object.entries(economy.industrySubsidies).filter(([site]) => owns(site))),
    };
    return { assigned, budget };
  };
  const government = partition(false), opposition = partition(true);
  const borderDispute: BorderDispute = {
    targetStateId: front, claimantId: rebel, defenderId: id, phase: "war", since: state.elapsedDays, goals: ["regime"],
    maneuvers: 0, allies: [], promises: [], defenders: [], mobilized: [], advance: [id, rebel], raid: [],
    progress: 50, lastChange: null, outcome: null,
  };
  const constitutionalCrises = { ...state.constitutionalCrises };
  delete constitutionalCrises[id];
  return {
    ...state, ownerByStateId, constitutionalCrises, borderDispute, lastEconomy: null,
    nations: { ...state.nations, [id]: government.assigned, [rebel]: opposition.assigned },
    countryEconomies: { ...state.countryEconomies, [id]: government.budget, [rebel]: opposition.budget },
    civilWar: { countryId: id, demand, side: null },
    tradeRoutes: state.tradeRoutes?.filter((route) => !sites.has(route.from) && !sites.has(route.to)),
  };
}

export function advanceCivilWar(scenario: Scenario, state: GameState): GameState {
  if (state.civilWar) {
    const battle = state.borderDispute!;
    if (battle.progress >= 100) return endCivilWar(state, "opposition");
    if (battle.progress <= 0) return endCivilWar(state, "government");
    if (state.elapsedDays - battle.since >= civilWarLimitDays)
      return endCivilWar(state, battle.progress > 50 ? "opposition" : "government");
    return state;
  }
  if (state.borderDispute && state.borderDispute.phase !== "resolved") return state;
  for (const id of Object.keys(state.constitutionalCrises ?? {})) {
    const warning = constitutionalCrisisWarning(state, id);
    if (!warning || state.elapsedDays - warning.since < civilWarEscalationDays) continue;
    const changed = startCivilWar(scenario, state, id, warning.demand);
    if (changed !== state) return changed;
  }
  return state;
}

function combineFiscal(home: FiscalAccount | undefined, rebel: FiscalAccount | undefined): FiscalAccount | undefined {
  if (!home || !rebel) return home ?? rebel;
  const first = apportionedFiscal(home, (value) => value);
  first.debt += rebel.debt;
  first.arrears += rebel.arrears;
  first.taxHistory = first.taxHistory.map((tax, i) => tax + rebel.taxHistory[i]);
  for (const key of ["creditLimit", "borrowed", "repaid", "interestDue", "interestPaid", "upkeepDue", "upkeepPaid"] as const)
    first.week[key] += rebel.week[key];
  if (["restricted", "defaulted"].includes(rebel.week.risk)) first.week.risk = rebel.week.risk;
  return first;
}

export function endCivilWar(state: GameState, winner: CivilSide): GameState {
  const { countryId: id, demand } = state.civilWar!;
  const rebel = oppositionId(id);
  const { [rebel]: opposition, ...nations } = state.nations;
  const { [rebel]: budget, ...countryEconomies } = state.countryEconomies;
  const government = nations[id], economy = countryEconomies[id];
  const oppositionWon = winner === "opposition";
  const policy = oppositionWon ? opposition : government;
  const category = constitutionLawCategory(demand);
  const owned = Object.fromEntries(Object.entries(state.ownerByStateId).map(([site, owner]) => [site, owner === rebel ? id : owner]));
  nations[id] = {
    ...policy,
    laws: oppositionWon ? [...policy.laws.filter((law) => constitutionLawCategory(law) !== category), demand] : policy.laws,
    reform: oppositionWon ? null : policy.reform, reformProgress: oppositionWon ? 0 : policy.reformProgress,
    interests: government.interests, marketLeader: government.marketLeader, tradePartners: government.tradePartners,
    overlord: government.overlord, subjectType: government.subjectType, prestige: government.prestige, infamy: government.infamy,
    privateQueue: [...government.privateQueue, ...opposition.privateQueue], investment: government.investment + opposition.investment,
    convoys: government.convoys + opposition.convoys,
    fleet: {
      ...policy.fleet, order: policy.fleet.order ?? (oppositionWon ? government.fleet.order : opposition.fleet.order),
      stores: government.fleet.stores + opposition.fleet.stores, oil: government.fleet.oil + opposition.fleet.oil,
      rubber: government.fleet.rubber + opposition.fleet.rubber, motorized: government.fleet.motorized + opposition.fleet.motorized,
      fueled: government.fleet.fueled + opposition.fleet.fueled,
    },
    navy: {
      ...policy.navy, order: policy.navy.order ?? (oppositionWon ? government.navy.order : opposition.navy.order),
      warships: government.navy.warships + opposition.navy.warships, armored: government.navy.armored + opposition.navy.armored,
      stores: government.navy.stores + opposition.navy.stores,
    },
  };
  countryEconomies[id] = {
    ...economy, treasury: economy.treasury + budget.treasury, queue: [...economy.queue, ...budget.queue],
    fiscal: combineFiscal(economy.fiscal, budget.fiscal), industrySubsidies: { ...economy.industrySubsidies, ...budget.industrySubsidies },
  };
  for (const [id, nation] of Object.entries(nations)) {
    if (nation.marketLeader === rebel || nation.tradePartners.includes(rebel)) {
      nations[id] = {
        ...nation, marketLeader: nation.marketLeader === rebel ? null : nation.marketLeader,
        tradePartners: nation.tradePartners.filter((partner) => partner !== rebel),
      };
    }
  }
  const constitutionalCrises = { ...state.constitutionalCrises, [id]: { compromiseUntil: state.elapsedDays + compromiseDays } };
  delete constitutionalCrises[rebel];
  return {
    ...state, ownerByStateId: owned, nations, countryEconomies, civilWar: undefined, borderDispute: null, occupation: undefined,
    constitutionalCrises, lastCivilWar: { countryId: id, demand, winner, endedDay: state.elapsedDays }, lastEconomy: null,
    tradeRoutes: state.tradeRoutes?.filter((route) => route.exporter !== rebel && route.importer !== rebel),
    diplomaticTies: state.diplomaticTies?.filter((row) => row.senior !== rebel && row.partner !== rebel),
    foreignRelations: state.foreignRelations?.filter((row) => row.a !== rebel && row.b !== rebel),
    foreignTreaties: state.foreignTreaties?.filter((row) => row.a !== rebel && row.b !== rebel),
    treatyOffers: state.treatyOffers?.filter((row) => row.from !== rebel && row.to !== rebel),
    aidOffers: state.aidOffers?.filter((row) => row.from !== rebel && row.to !== rebel),
    foreignObligations: state.foreignObligations?.filter((row) => row.creditor !== rebel && row.debtor !== rebel),
    territorialClaims: state.territorialClaims?.filter((row) => row.claimantId !== rebel && owned[row.stateId] !== row.claimantId)
      .map((row) => ({ ...row, recognizedBy: row.recognizedBy.filter((country) => country !== rebel) })),
    territorialSettlements: state.territorialSettlements?.filter((row) => row.countryId !== rebel),
    opiumLosses: state.opiumLosses?.filter((row) => row.exporter !== rebel && row.importer !== rebel),
  };
}
