import { GameRuleError } from "./rules.ts";
import { changeDifficulty, initialSettings, openingReserve } from "./settings.ts";
import type { Difficulty, GameSettings, RuleTuning } from "./settings.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { advanceFront, aiDiplomacy, applyBorderCommand, attacking, participants, planWar, tickDiplomacy } from "./diplomacy.ts";
import type { BorderCommand, BorderDispute } from "./diplomacy.ts";
import { chooseAdministrativeArchive, chooseConstruction, chooseElectrification, chooseIndustrialRetrofit, choosePort, chooseRailway, chooseUniversity, constructionError,
  initialStateEconomy, projectDeposit, projectOpeningCapital, projects, settleEconomy } from "./economy.ts";
import type { Building, CountryEconomy, EconomyReport, StateEconomy } from "./economy.ts";
import { advancePolitics, applyPolitics, availableTech, ownedSocieties, politicsError } from "./politics.ts";
import type { PoliticsCommand } from "./politics.ts";
import { initSociety, techs, hash, literacyOf } from "./society.ts";
import type { Law, Nation, SiteSocial } from "./society.ts";
import { advanceTerritorialSettlements, applyTerritorialClaim, applyTerritorialSettlement, chooseTerritorialSettlement } from "./territory.ts";
import type { TerritorialClaim, TerritorialClaimCommand, TerritorialSettlement, TerritorialSettlementCommand } from "./territory.ts";
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
import { institutionCommands, institutionLawKinds, institutionLawLimit, institutionLawOptions, institutionLevelError,
  institutionLevelSchema, institutionNames, institutionStaffNeed, institutions } from "./institutions.ts";
import type { Institution } from "./institutions.ts";
import { laborStatus } from "./labor.ts";
import { exciseGoodsSchema, taxBands, taxBandSchema, taxPolicy } from "./taxation.ts";
import { applyTradePolicy, tariffBands, tariffRate, tariffRates } from "./trade-policy.ts";
import type { TradePolicyCommand } from "./trade-policy.ts";
import { civicLawOf } from "./civic-policy.ts";
import { powerDistribution } from "./constitution.ts";
import { projectOwnership } from "./ownership.ts";
import { industrySubsidyLimit } from "./industrial.ts";
import { applyForeignCommand, settleAiForeignOffers } from "./foreign-relations.ts";
import type { AidOffer, ForeignCommand, ForeignObligation, ForeignRelation, ForeignTreaty, TreatyOffer } from "./foreign-relations.ts";
import { applyBattalionOrder, applyEquipmentOrder, chooseBattalionOrder, chooseEquipmentOrder } from "./military.ts";
import type { BattalionCommand, BattalionEquipmentCommand } from "./military.ts";
import { recoverMilitaryInjuries } from "./military-health.ts";
import { applyNavalConstruction, warshipMaterials } from "./navy.ts";
import type { NavalConstructionCommand } from "./navy.ts";
import { opiumLaw } from "./opium.ts";
import type { OpiumLoss } from "./opium.ts";
import { advanceConstitutionalCrises, applyConstitutionalCompromise, compromiseCost, constitutionalCompromiseError } from "./constitutional-crises.ts";
import type { ConstitutionalCrisis, ConstitutionalCrisisCommand } from "./constitutional-crises.ts";
import {
  advanceCivilWar, chooseCivilWarSide, controlledCivilCountry, mustChooseCivilSide, oppositionId, scenarioWithCivilWar,
} from "./civil-war.ts";
import type { CivilWar, CivilWarCommand, CivilWarResult } from "./civil-war.ts";
import { militaryServiceLaw } from "./military-service.ts";
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
  foreignRelations?: ForeignRelation[];
  foreignTreaties?: ForeignTreaty[];
  treatyOffers?: TreatyOffer[];
  aidOffers?: AidOffer[];
  foreignObligations?: ForeignObligation[];
  territorialClaims?: TerritorialClaim[];
  territorialSettlements?: TerritorialSettlement[];
  opiumLosses?: OpiumLoss[];
  constitutionalCrises?: Record<string, ConstitutionalCrisis>;
  civilWar?: CivilWar;
  lastCivilWar?: CivilWarResult;
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
  | TerritorialSettlementCommand
  | TerritorialClaimCommand
  | { type: "queueConstruction"; countryId: string; stateId: string; good: Building; privateBuild?: boolean }
  | { type: "cancelConstruction"; countryId: string; index: number; stateId: string; good: Building; privateBuild?: boolean }
  | { type: "setConvoyOrder"; countryId: string; stateId: string; operation: "add" | "move" | "cancel" }
  | { type: "setFleetMotorization"; countryId: string; stateId: string; enabled: boolean }
  | { type: (typeof institutionCommands)[Institution]; countryId: string; stateId: string; level: number }
  | { type: "setTaxBand"; countryId: string; band: Nation["taxBand"] }
  | { type: "setExciseGoods"; countryId: string; goods: Nation["exciseGoods"] }
  | { type: "setIndustrySubsidy"; countryId: string; stateId: string; limit: number }
  | { type: "advanceTick" | "advanceWeek" | "advanceDay" | "advanceHalfYear" }
  | PoliticsCommand
  | ConstitutionalCrisisCommand
  | CivilWarCommand
  | GovernanceCommand
  | TradeCommand
  | TradePolicyCommand
  | ForeignCommand
  | BattalionCommand
  | BattalionEquipmentCommand
  | NavalConstructionCommand
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

function chooseInstitutionUpgrade(state: GameState, report: EconomyReport, countryId: string, kind: Institution) {
  const nation = state.nations[countryId];
  if (kind === "healthcare" && nation.knowledge["公共卫生"] < 100) return;
  const treasury = state.countryEconomies[countryId].treasury;
  const market = report.countries[countryId].market;
  return Object.entries(state.societies).flatMap(([stateId, site]) => {
    if (state.ownerByStateId[stateId] !== countryId || state.occupation?.stateId === stateId || site[kind] === 3) return [];
    const level = site[kind] + 1;
    if (institutionLevelError(kind, level, nation.laws, nation.knowledge)) return [];
    const local = report.states[stateId];
    const unrest = site.stability?.unrest ?? 0;
    const foodGap = 1 - local.foodFulfillment!;
    if (kind === "policing" && unrest < 25 || kind === "welfare" && foodGap < 0.20) return [];
    if (kind !== "healthcare" && (local.industries.services.output === 0 ||
        market.paper.supply === 0 || market.tools.supply === 0)) return [];
    const population = state.stateEconomies[stateId].population;
    const coverage = local[kind]?.coverage ?? 0;
    const weeklyReserve = institutionStaffNeed(population, level) * (kind === "welfare" ? 1_000 : 250);
    const priority = kind === "policing" ? unrest : kind === "welfare" ? foodGap :
      kind === "education" ? 100 - literacyOf(site.pops) : 0;
    return coverage >= 0.7 * site[kind] / 3 && treasury >= weeklyReserve * 26
      ? [{ stateId, level, population, priority }] : [];
  }).sort((a, b) => b.priority - a.priority || a.level - b.level || b.population - a.population)[0];
}

function chooseInstitutionLaw(state: GameState, report: EconomyReport, countryId: string): PoliticsCommand | undefined {
  const nation = state.nations[countryId];
  const owned = Object.keys(state.ownerByStateId).filter((id) => state.ownerByStateId[id] === countryId);
  for (const kind of institutionLawKinds) {
    const level = institutionLawLimit(nation.laws, kind);
    if (level === 3 || !owned.some((id) => state.societies[id][kind] >= level &&
        (report.states[id][kind]?.coverage ?? 0) >= 0.7 * level / 3)) continue;
    const proposal = { type: "proposeLaw", countryId, law: institutionLawOptions[kind][level] } as const;
    if (!politicsError(state, proposal)) return proposal;
  }
}

function chooseMilitaryServiceLaw(state: GameState, report: EconomyReport, countryId: string): PoliticsCommand | undefined {
  const dispute = state.borderDispute;
  const risk = state.countryEconomies[countryId].fiscal!.week.risk;
  const sustainable = risk === "stable" || risk === "warning";
  const service = militaryServiceLaw(state.nations[countryId].laws);
  const front = dispute?.phase === "war" && participants(dispute).includes(countryId) ? dispute : undefined;
  const pressure = front && (attacking(front, countryId) ? front.progress < 40 : front.progress > 60);
  const law = sustainable && pressure ? "义务兵役"
    : !front && !sustainable && report.countries[countryId].military.regulars >= 100 ? "地方民兵"
    : sustainable && service === "地方民兵" ? "职业常备军" : undefined;
  if (!law) return;
  const proposal = { type: "proposeLaw", countryId, law } as const;
  if (!politicsError(state, proposal)) return proposal;
}

function chooseLaborLaw(state: GameState, countryId: string): PoliticsCommand | undefined {
  const laws = state.nations[countryId].laws;
  const proposals: Law[] = [];
  if (laborStatus(laws) !== "自由劳动") proposals.push("自由劳动");
  if (!laws.includes("妇女平等权")) proposals.push(laws.includes("妇女就业权") ? "妇女平等权" : "妇女就业权");
  if (!laws.includes("集体劳动保障")) proposals.push(laws.includes("工时与工伤保障") ? "集体劳动保障" : "工时与工伤保障");
  for (const law of proposals) {
    const proposal = { type: "proposeLaw", countryId, law } as const;
    if (!politicsError(state, proposal)) return proposal;
  }
}

function chooseCivicLaw(state: GameState, countryId: string): PoliticsCommand | undefined {
  const nation = state.nations[countryId];
  const people = ownedSocieties(state, countryId).flatMap((site) => site.pops);
  const citizenship = civicLawOf(nation.laws, "citizenship");
  const religion = civicLawOf(nation.laws, "religion");
  const speech = civicLawOf(nation.laws, "speech");
  const developed = nation.knowledge["大众政治"] === 100;
  const proposals: Law[] = [];
  if (people.some((pop) => pop.people > 0 && pop.culture !== countryId)) {
    if (citizenship === "本族公民权") proposals.push("有限公民权");
    else if (citizenship === "有限公民权" && developed) proposals.push("平等公民权");
  }
  if (people.some((pop) => pop.people > 0 && pop.religion !== countryId)) {
    if (religion === "国教优先") proposals.push("宗教宽容");
    else if (religion === "宗教宽容" && developed) proposals.push("信仰自由");
  }
  if (nation.research !== null) {
    if (speech === "出版审查") proposals.push("有限出版");
    else if (speech === "有限出版" && developed) proposals.push("出版自由");
  }
  for (const law of proposals) {
    const proposal = { type: "proposeLaw", countryId, law } as const;
    if (!politicsError(state, proposal)) return proposal;
  }
}

function chooseOpiumLaw(state: GameState, countryId: string): PoliticsCommand | undefined {
  const law = opiumLaw(state.nations[countryId].laws);
  if (law === "鸦片禁令") return;
  let population = 0, affected = 0;
  for (const [id, owner] of Object.entries(state.ownerByStateId)) {
    if (owner !== countryId) continue;
    const residents = state.stateEconomies[id].population;
    population += residents;
    affected += residents * (state.societies[id].opiumBurden ?? 0);
  }
  if (affected < population * (law === "鸦片许可经营" ? 15 : 35)) return;
  const proposal = { type: "proposeLaw", countryId,
    law: law === "鸦片许可经营" ? "鸦片限医疗" : "鸦片禁令" } as const;
  if (!politicsError(state, proposal)) return proposal;
}

export function advanceTick(
  baseScenario: Scenario,
  state: GameState,
  humanCountries: ReadonlySet<string | null> = new Set([state.playerCountryId]),
): GameState {
  if (isScenarioFinished(baseScenario, state)) return state;
  const war = state.civilWar;
  if (war && humanCountries.has(war.countryId)) {
    if (state.playerCountryId === war.countryId && state.campaign && war.side === null) return state;
    const actors = new Set(humanCountries);
    if (war.side !== "government") actors.add(oppositionId(war.countryId));
    if (war.side === "opposition") actors.delete(war.countryId);
    humanCountries = actors;
  }
  const tickInDay = state.tickInDay + 1;
  if (tickInDay < TICKS_PER_DAY) return { ...state, tickInDay };
  const scenario = scenarioWithCivilWar(baseScenario, war);
  const next = tickDiplomacy(scenario, { ...state, elapsedDays: state.elapsedDays + 1, tickInDay: 0 }, humanCountries);
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
  const battle = advanceFront(scenario, settled, settled.lastEconomy);
  const recovered = recoverMilitaryInjuries(battle, settled.lastEconomy);
  let result = advanceConstitutionalCrises(
    advancePolitics(recovered, settled.lastEconomy, date.getUTCFullYear(), yearFraction),
  );
  result.rng = (Math.imul(result.rng, 1664525) + 1013904223) >>> 0;
  const owners = new Set(Object.values(result.ownerByStateId));
  for (const id of owners) {
    const { market } = settled.lastEconomy.countries[id];
    if (!humanCountries.has(id)) {
      const settlement = chooseTerritorialSettlement(scenario, result, id);
      if (settlement) result = applyCommand(scenario, result, settlement);
      const job = chooseUniversity(scenario, result, id) ?? chooseRailway(scenario, result, id, settled.lastEconomy) ??
        chooseAdministrativeArchive(scenario, result, id, settled.lastEconomy) ??
        choosePort(scenario, result, id, settled.lastEconomy) ?? chooseElectrification(scenario, result, id) ??
        chooseIndustrialRetrofit(scenario, result, id, settled.lastEconomy) ??
        chooseConstruction(scenario, result, id, market);
      if (result.elapsedDays % 28 === 0) {
        const fiscal = result.countryEconomies[id].fiscal!;
        const band = taxBands.indexOf(result.nations[id].taxBand);
        if ((fiscal.week.risk === "restricted" || fiscal.week.risk === "defaulted") && band < taxBands.length - 1) {
          result = applyCommand(scenario, result, { type: "setTaxBand", countryId: id, band: taxBands[band + 1] });
        }
        const nation = result.nations[id];
        const nextTariff = tariffBands[tariffBands.indexOf(nation.tariffBand) + 1];
        if (fiscal.week.risk === "restricted" && tariffRate(nation) > 0 && nextTariff) {
          const shipments = settled.lastEconomy.trade?.filter((row) => row.status === "shipped" && settled.ownerByStateId[row.to] === id);
          if (shipments?.length && shipments.every((row) =>
            row.profit > Math.floor(row.purchase * tariffRates[nextTariff] / 100) - row.tariff))
            result = applyCommand(scenario, result, { type: "setTariffBand", countryId: id, band: nextTariff });
        }
        const integration = chooseIntegration(result, id);
        if (integration) result = applyGovernanceCommand(result, integration);
        const agreement = chooseLocalNegotiation(result, id);
        if (agreement) result = negotiateLocalUnrest(result, agreement);
        for (const kind of institutions) {
          const target = chooseInstitutionUpgrade(result, settled.lastEconomy, id, kind);
          if (target) result = applyCommand(scenario, result, {
            type: institutionCommands[kind], countryId: id, stateId: target.stateId, level: target.level,
          });
        }
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
      const fleetNation = result.nations[id];
      const model = fleetNation.knowledge["装甲舰艇"] === 100 ? "armored" : "standard";
      if (result.elapsedDays % 28 === 0 && port && result.occupation?.stateId !== port && !fleetNation.navy.order &&
          fleetNation.navy.warships < 1 + Math.floor(fleetNation.convoys / 6) &&
          result.countryEconomies[id].treasury >= warshipMaterials[model] * industries.shipGoods.basePrice * 2 &&
          report.market.shipGoods.supply >= warshipMaterials[model]) {
        result = applyCommand(scenario, result, { type: "setWarshipOrder", countryId: id, stateId: port, operation: "add", model });
      }
      if (result.elapsedDays % 28 === 0 && port && result.occupation?.stateId !== port &&
          fleetNation.knowledge["内燃机"] === 100 && fleetNation.convoys > fleetNation.fleet.motorized &&
          fleetNation.fleet.motorizationPort === null && occupiedCargo > 0 &&
          (["oil", "rubber"] as const).every((good) =>
            Object.values(scenario.states).some((s) => result.ownerByStateId[s.id] === id && (s.capacity[good] ?? 0) > 0) ||
            result.tradeRoutes?.some((route) => route.importer === id && route.to === port && route.good === good && !route.paused))) {
        result = applyCommand(scenario, result, { type: "setFleetMotorization", countryId: id, stateId: port, enabled: true });
      }
      const armyOrder = chooseEquipmentOrder(result, settled.lastEconomy, id) ?? chooseBattalionOrder(result, settled.lastEconomy, id);
      if (armyOrder) result = applyCommand(scenario, result, armyOrder);
      if (result.countryEconomies[id].treasury >= 2 * compromiseCost && !constitutionalCompromiseError(result, id)) {
        result = applyCommand(scenario, result, { type: "offerConstitutionalCompromise", countryId: id });
      }
      const n = result.nations[id];
      const pending = techs.filter((t) => availableTech(n, t));
      if (!n.research && pending.length)
        result = applyCommand(scenario, result, {
          type: "startResearch",
          countryId: id,
          tech: pending[(result.rng + hash(id)) % pending.length],
        });
      if (!n.reform) {
        const proposal = result.elapsedDays % 28 === 0
          ? chooseMilitaryServiceLaw(result, settled.lastEconomy, id) ?? chooseOpiumLaw(result, id) ?? chooseLaborLaw(result, id) ??
            chooseInstitutionLaw(result, settled.lastEconomy, id) ?? chooseCivicLaw(result, id)
          : undefined;
        if (proposal) result = applyCommand(scenario, result, proposal);
        else if (powerDistribution(n) !== "universal") {
          const law = powerDistribution(n) === "autocracy" ? "有限选举" : "普选制";
          const cmd = { type: "proposeLaw", countryId: id, law } as const;
          if (!politicsError(result, cmd)) result = applyCommand(scenario, result, cmd);
        }
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
  result = settleAiForeignOffers(result, humanCountries);
  result = advanceTerritorialSettlements(scenario, result, settled.lastEconomy);
  result = advanceCivilWar(baseScenario, result);
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
      if ("countryId" in cmd && cmd.type !== "chooseCivilWarSide" && mustChooseCivilSide(state, state.playerCountryId))
        throw new GameRuleError("请先选择内战阵营");
      if ("countryId" in cmd && cmd.type !== "chooseCivilWarSide" && state.civilWar?.countryId === state.playerCountryId &&
          cmd.countryId !== controlledCivilCountry(state, state.playerCountryId))
        throw new GameRuleError("只能操作已选择的内战阵营");
      const next = applyCommand(scenarioWithCivilWar(scenario, state.civilWar), state, cmd);
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
    case "setTaxBand":
    case "setExciseGoods": {
      const nation = state.nations[cmd.countryId];
      if (!nation) throw new GameRuleError("无法设置陌生国家的税收");
      if (cmd.type === "setTaxBand") {
        if (!taxBandSchema.safeParse(cmd.band).success) throw new GameRuleError("税率档位无效");
        return { ...state, nations: { ...state.nations, [cmd.countryId]: { ...nation, taxBand: cmd.band } } };
      }
      if (taxPolicy(nation).system !== "消费税制") throw new GameRuleError("需先施行消费税制");
      const selected = exciseGoodsSchema.safeParse(cmd.goods);
      if (!selected.success) throw new GameRuleError("消费税商品无效或重复");
      return { ...state, nations: { ...state.nations, [cmd.countryId]: { ...nation, exciseGoods: selected.data } } };
    }
    case "claimState":
    case "cancelTerritorialSettlement":
      return applyTerritorialSettlement(scenario, state, cmd);
    case "declareTerritorialClaim":
    case "renounceTerritorialClaim":
      return applyTerritorialClaim(scenario, state, cmd);
    case "setIndustrySubsidy": {
      const { countryId, stateId, limit } = cmd;
      if (state.ownerByStateId[stateId] !== countryId) throw new GameRuleError("只能补贴本国州的产业");
      if (!industrySubsidyLimit.safeParse(limit).success) throw new GameRuleError("产业补贴上限须为非负整数");
      if (limit > 0 && (!state.stateEconomies[stateId].industrial || state.occupation?.stateId === stateId))
        throw new GameRuleError("现有产业可在本国实际控制时申请补贴");
      const country = state.countryEconomies[countryId];
      const industrySubsidies = { ...country.industrySubsidies };
      if (limit > 0) industrySubsidies[stateId] = limit;
      else delete industrySubsidies[stateId];
      return { ...state, countryEconomies: { ...state.countryEconomies, [countryId]: { ...country, industrySubsidies } } };
    }
    case "setLocalGovernance":
    case "startIntegration":
    case "cancelIntegration":
      return applyGovernanceCommand(state, cmd);
    case "openTradeRoute":
    case "setTradeRoute":
    case "removeTradeRoute":
      return applyTradeCommand(scenario, state, cmd);
    case "setTariffBand":
    case "setTradePartner":
      return applyTradePolicy(state, cmd);
    case "improveRelations":
    case "offerTreaty":
    case "acceptTreaty":
    case "declineTreaty":
    case "endTreaty":
    case "offerDiplomaticAid":
    case "acceptDiplomaticAid":
    case "declineDiplomaticAid":
      return applyForeignCommand(state, cmd);
    case "reorganizeBattalion":
      return applyBattalionOrder(state, cmd);
    case "setBattalionEquipment":
      return applyEquipmentOrder(state, cmd);
    case "setWarshipOrder":
      return applyNavalConstruction(scenario, state, cmd);
    case "negotiateLocalUnrest":
      return negotiateLocalUnrest(state, cmd);
    case "queueConstruction": {
      const { countryId: id, stateId, good, privateBuild } = cmd;
      const error = constructionError(scenario, state, id, stateId, good, privateBuild);
      if (error) throw new GameRuleError(error);
      const cost = projectDeposit(good), { weeks } = projects[good],
        job = { stateId, good, weeksLeft: weeks,
          ...(isGood(good) ? { ownership: projectOwnership(good, state.nations[id].laws, privateBuild === true) } : {}) };
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
    case "setFleetMotorization": {
      const { countryId: id, stateId, enabled } = cmd;
      if (state.ownerByStateId[stateId] !== id || !scenario.states[stateId]?.coastal)
        throw new GameRuleError("只能在本国沿海州安排商船改装");
      const nation = state.nations[id];
      if (enabled) {
        if (nation.knowledge["内燃机"] !== 100) throw new GameRuleError("需要掌握内燃机技术");
        if (nation.convoys <= nation.fleet.motorized) throw new GameRuleError("没有待改装的商船");
        if (state.occupation?.stateId === stateId) throw new GameRuleError("该港口处于军事占领中");
      } else if (nation.fleet.motorizationPort !== stateId) throw new GameRuleError("该港口没有商船改装计划");
      const fleet = { ...nation.fleet, motorizationPort: enabled ? stateId : null };
      return { ...state, nations: { ...state.nations, [id]: { ...nation, fleet } } };
    }
    case "setHealthcareLevel":
    case "setPolicingLevel":
    case "setWelfareLevel":
    case "setEducationLevel": {
      const { countryId, stateId, level } = cmd;
      const kind = institutions.find((institution) => institutionCommands[institution] === cmd.type)!;
      if (!institutionLevelSchema.safeParse(level).success) throw new GameRuleError(`${institutionNames[kind]}等级须为 0–3`);
      if (state.ownerByStateId[stateId] !== countryId) throw new GameRuleError("只能调整本国州的公共机构");
      const site = state.societies[stateId];
      if (level === site[kind]) return state;
      if (level > site[kind]) {
        if (state.occupation?.stateId === stateId) throw new GameRuleError("该州处于军事占领中");
        const nation = state.nations[countryId];
        const error = institutionLevelError(kind, level, nation.laws, nation.knowledge);
        if (error) throw new GameRuleError(error);
      }
      return { ...state, societies: { ...state.societies, [stateId]: { ...site, [kind]: level } } };
    }
    case "setGovernment":
    case "proposeLaw":
    case "startResearch":
      return applyPolitics(state, cmd);
    case "offerConstitutionalCompromise":
      return applyConstitutionalCompromise(state, cmd.countryId);
    case "chooseCivilWarSide":
      return chooseCivilWarSide(state, cmd);
    default:
      return applyBorderCommand(scenario, state, cmd);
  }
}
