import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import { elapsedTicks } from "./time.ts";
import type { WarPlan } from "./diplomacy.ts";
import { byGood, byIndustrialGood, commercialLevels, goods, industries, isGood, isIndustrialGood, isLocalGood, legacyCommercialCost } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import { evolvePops, facilityTypes, approval, tributeRate } from "./society.ts";
import type { Nation, SiteSocial } from "./society.ts";
import { getEconomicRules } from "./politics.ts";
import { ruleTuning } from "./settings.ts";
import { clearMarket, marketOf, nextPrice, targetPrice } from "./market.ts";
import type { MarketFill } from "./market.ts";
import { availablePrepaymentCredit, settleFiscal } from "./fiscal.ts";
import type { FiscalAccount } from "./fiscal.ts";
import { allocateHouseholdIncome, basicEquivalentSupply, byExtraGood, extrasOrders, fundBasicBasket, isExtraGood,
  livingStandardTarget, openingBasicBudget, planBasicBasket, substitutedBasketCost } from "./households.ts";
import type { BasicPurchases, ExtrasReport, SubstituteOrders } from "./households.ts";
import { administrationWage, advanceIntegration, governanceOf, governanceRules,
  integrationStaffNeeded, integrationWeekShare } from "./governance.ts";
import { expectedTrade, settleTrade } from "./trade.ts";
import type { TradeDelivery } from "./trade.ts";
import { unrestEffects } from "./unrest.ts";
import { affordableIndustryWorkers, electricityUse, electricIndustries, electricRetrofits, emptyIndustrialAccount,
  fundedRestock, initialIndustrialAccount, industrialPayroll, industryMethod, materialWorkers, operateIndustry,
  trainedLabourCapacity, workingCapitalPerLevel, workingCapitalTarget } from "./industrial.ts";
import type { IndustrialAccount, IndustrialReport } from "./industrial.ts";
import { deliverOffice, officeNeed, planOffice } from "./administration.ts";
import type { OfficeReport } from "./administration.ts";
import { byInstitution, byInstitutionGood, deliverInstitution, deliverInstitutionOrders,
  deliverWelfareRelief, institutionGoods, institutionLawLimit, institutions, isInstitutionGood, planInstitution, planWelfareRelief } from "./institutions.ts";
import type { Institution, InstitutionReport, WelfareRelief } from "./institutions.ts";
import { harvestGood, isCrop, rentRateOf, reservedCropland, subsistenceHarvest } from "./subsistence.ts";
import type { SubsistenceReport } from "./subsistence.ts";
import { affordableCrew, constructionJobs, constructionMaterials, constructionPointsPerLevel, constructionSectors,
  constructionSpending, crewMaterials, deliverConstruction, emptyConstructionReport, materialOrder,
  planConstructionMaintenance, reserveCrew, shareCrew } from "./construction.ts";
import type { ConstructionMaintenance, ConstructionReport, ConstructionSector, ConstructionStock } from "./construction.ts";
import { portCapacity, railCapacityPerLevel } from "./transport.ts";
import { byFleetGood, closeFleet, fleetGoods, fleetMaintenance, fleetSpending, isFleetGood,
  rubberPerMotor, shipGoodsPerConvoy, shipGoodsPerMotor } from "./fleet.ts";
import type { FleetGood, FleetReport } from "./fleet.ts";
import { bondedRuralWorkers, laborProtection, ruralPopulation, workForce } from "./labor.ts";
import { exciseOn, settleIncomeTax, taxPolicy } from "./taxation.ts";
import type { HouseholdIncome, TaxSystem } from "./taxation.ts";
import { civicPolicy, civicStanding } from "./civic-policy.ts";

export { marketOf } from "./market.ts";

export const universityJobs = 100;
export const universityWage = 180;

export type Building = Good | (typeof facilityTypes)[number];
export const projects = {
  ...industries,
  infrastructure: { cost: 210000, weeks: 2 },
  railway: { cost: 300000, weeks: 5 },
  port: { cost: 330000, weeks: 6 },
  electrifyTools: { cost: 190000, weeks: 4 },
  electrifySteel: { cost: 190000, weeks: 4 },
  university: { cost: 360000, weeks: 3 },
  bureaucracy: { cost: 180000, weeks: 4 },
  construction: { cost: 300000, weeks: 3 },
  barracks: { cost: 180000, weeks: 2 },
  conscription: { cost: 120000, weeks: 2 },
};
export interface StateEconomy {
  population: number;
  buildings: ByGood<number>;
  localQuotes?: ByGood<number>;
  industrial?: IndustrialAccount;
  cropland?: number;
  commercialRecipes?: true;
  inheritedArmamentCapacity?: Partial<ArmamentOrders>;
  constructionStock?: ConstructionStock;
  basicBudget: number;
  discretionaryBudget?: number;
}
export function initialStateEconomy(site: Scenario["states"][string]): StateEconomy {
  const buildings = byGood((good) => site.buildings[good] ?? 0);
  const industrial = initialIndustrialAccount(buildings);
  return { population: site.population, buildings, commercialRecipes: true, basicBudget: openingBasicBudget(site.population),
    ...(industrial ? { industrial } : {}),
    ...(site.cropland === undefined ? {} : { cropland: site.cropland }) };
}
export interface Project {
  stateId: string;
  good: Building;
  weeksLeft: number;
  levels?: number;
}
export function projectPoints(good: Building) {
  if (good === "railway") return 250;
  if (good === "port") return 300;
  if (isGood(good)) {
    if (isCrop(good)) return 100;
    if (good === "wood" || good === "iron" || good === "coal" || good === "oil") return 150;
    return 200;
  }
  return good === "barracks" || good === "conscription" ? 100 : 180;
}
export function remainingProjectPoints(project: Project) {
  return project.weeksLeft * projectPoints(project.good) / projects[project.good].weeks;
}
export function projectDeposit(good: Building) {
  return isGood(good) ? workingCapitalPerLevel(good) : 0;
}
export function projectOpeningCapital(project: Project) {
  const { good, levels } = project;
  const capital = projectDeposit(good) * (levels ?? 1);
  return levels && isGood(good) && !isIndustrialGood(good) ? Math.min(capital, legacyCommercialCost[good]) : capital;
}
export function unusedPrepaidConstruction(project: Project) {
  const { good, levels, weeksLeft } = project;
  const { cost, weeks } = projects[good];
  const deposit = levels && isGood(good) && !isIndustrialGood(good) ? legacyCommercialCost[good] : cost;
  return Math.floor(Math.max(0, deposit - projectOpeningCapital(project)) * weeksLeft / weeks);
}
export interface CountryEconomy {
  treasury: number;
  queue: Project[];
  referenceQuotes?: ByGood<number>;
  fiscal?: FiscalAccount;
}
export interface Market {
  demand: number;
  supply: number;
  price: number;
  traded?: number;
  targetPrice?: number;
}
interface IndustryReport {
  employed: number;
  output: number;
  wages: number;
  sold?: number;
  bought?: number;
  electric?: true;
}
export interface MilitarySupply {
  regulars: number;
  conscripts: number;
  grainDemand: number;
  grainDrawn: number;
  grainTransport: number;
  seaCargoUsed?: number;
  procurement?: { grain: number; cloth: number; arms?: number; ammo?: number };
  equipment: Record<"weapons" | "ammunition" | "uniforms", { demand: number; delivered: number }>;
  readiness: number;
}
export interface SiteReport {
  workforce?: number;
  universityStaff?: number;
  administrationStaff?: number;
  freightWages?: number;
  portTradeCargo?: number;
  portMilitaryCargo?: number;
  power?: { requested: number; delivered: number; spending: number };
  industries: ByGood<IndustryReport>;
  populationChange?: number;
  foodFulfillment?: number;
  householdConsumption?: ByGood<number>;
  householdBasicPurchases?: BasicPurchases;
  householdBasicOrders?: ByGood<number>;
  householdSubstituteOrders?: SubstituteOrders;
  subsistence?: SubsistenceReport;
  householdExtras?: ExtrasReport;
  constructionGoods?: ByGood<number>;
  construction?: ConstructionReport;
  constructionMaintenance?: ConstructionMaintenance;
  industrial?: IndustrialReport;
  office?: OfficeReport;
  healthcare?: InstitutionReport;
  policing?: InstitutionReport;
  welfare?: InstitutionReport;
  education?: InstitutionReport;
  welfareRelief?: WelfareRelief;
  consumptionIndex?: number;
  conscripts: number;
  access: number;
  localPrices: ByGood<number>;
  dividends: number;
  investment: number;
  builders: number;
  regulars: number;
}
export interface CountryReport {
  market: ByGood<Market>;
  tax: number;
  wageTaxRate: number;
  wageTaxGain: number;
  taxReceipts?: { system: TaxSystem; band: Nation["taxBand"]; income: number; excise: number };
  clothOutputBonus: number;
  clothOutputGain: number;
  military: MilitarySupply;
  investment: number;
  capacity: number;
  construction?: ConstructionReport;
  constructionMaintenance?: ConstructionMaintenance;
  tribute: number;
  upkeep: number;
  interestPaid?: number;
  universityWages?: number;
  administrationWages?: number;
  officeUpkeep?: number;
  healthcareUpkeep?: number;
  policingUpkeep?: number;
  welfareUpkeep?: number;
  educationUpkeep?: number;
  tradeTariff?: number;
  tradeSeaCargo?: number;
  fleet?: FleetReport;
}
export interface EconomyReport {
  states: Record<string, SiteReport>;
  countries: Record<string, CountryReport>;
  trade?: TradeDelivery[];
}

export function weeklyBudgets(nations: GameState["nations"], report: EconomyReport) {
  const budgets = Object.fromEntries(Object.entries(report.countries).map(([id, country]) => [
    id, { tributeReceived: 0, balance: country.tax - country.upkeep - country.tribute - (country.interestPaid ?? 0) },
  ]));
  for (const [id, nation] of Object.entries(nations)) {
    if (nation.overlord === null) continue;
    const paid = report.countries[id].tribute;
    budgets[nation.overlord].tributeReceived += paid;
    budgets[nation.overlord].balance += paid;
  }
  return budgets;
}
export { workForce } from "./labor.ts";
const fulfillment = (bought: number, demand: number) => demand ? bought / demand : 1;
const siteTaxShare = (site: SiteSocial, occupied: boolean) => occupied ? 0 :
  unrestEffects(site.stability).collection * governanceRules[governanceOf(site).mode].centralTax / 100;

function privateHouseholdIncome(site: SiteReport): HouseholdIncome {
  const specialist = site.industrial?.skilledWages ?? 0;
  const wages = goods.reduce((sum, good) => sum + site.industries[good].wages, site.freightWages ?? 0);
  const capitalist = Math.floor(site.dividends / 2);
  return {
    农民: site.subsistence?.householdIncome ?? 0,
    劳工: wages - specialist + site.construction!.private.wages,
    工程师: specialist,
    资本家: capitalist,
    贵族: site.dividends - capitalist + (site.subsistence?.landRent ?? 0),
  };
}
const basketBaseValue = goods.reduce((total, good) =>
  total + industries[good].demandPerPerson * industries[good].basePrice, 0,
);
function orderQuoteCeilings(local: StateEconomy, market: CountryEconomy) {
  return byGood((good) => {
    const base = industries[good].basePrice;
    const previous = Math.max(local.localQuotes?.[good] ?? base, market.referenceQuotes?.[good] ?? base);
    return Math.round(nextPrice(previous, base * 1.75));
  });
}

export const privateShareOf = (n: GameState["nations"][string]) =>
  n.laws.includes("自由放任") ? 0.75 : n.laws.includes("干预主义") ? 0.5 : 0.20;
const equipmentGoods = { weapons: "arms", ammunition: "ammo", uniforms: "cloth" } as const;
const armamentGoods = ["arms", "ammo"] as const;
type ArmamentOrders = Record<(typeof armamentGoods)[number], number>;
type MilitaryGoods = Required<NonNullable<MilitarySupply["procurement"]>>;
interface SupplyContract {
  cash: number;
  prices: MilitaryGoods;
  spending: MilitaryGoods;
  proceeds: Map<string, number>;
}

export function militaryProcurementCost(spending: MilitarySupply["procurement"]) {
  return spending === undefined ? 0 : spending.grain + spending.cloth + (spending.arms ?? 0) + (spending.ammo ?? 0);
}

function equipmentNeeds(strength: number, field: boolean) {
  return {
    weapons: Math.ceil(strength * (field ? 20 : 5) / 1000),
    ammunition: Math.ceil(strength * (field ? 40 : 5) / 1000),
    uniforms: Math.ceil(strength * (field ? 20 : 10) / 1000),
  };
}

function siteMilitaryShare(site: SiteSocial) {
  return governanceRules[governanceOf(site).mode].militaryShare;
}

function garrisonSize(site: SiteSocial, population: number) {
  return Math.floor(Math.min(site.barracks * 100, population * 0.03) * siteMilitaryShare(site));
}

function availableEngineers(site: SiteSocial, owner: string, nation: GameState["nations"][string]) {
  const policy = civicPolicy(nation.laws);
  return site.pops.filter((p) => p.occupation === "工程师")
    .reduce((sum, p) => sum + p.people * (0.65 + 0.35 * civicStanding(p, owner, site, policy)), 0);
}

function militarySources(ids: string[], route: WarPlan["routes"][string]) {
  const rear = ids.filter((id) => !route.recruitmentStates.has(id));
  const front = ids.filter((id) => route.connectedStates.has(id));
  return { front, rear };
}

function planArmamentOrders(state: GameState, holdings: Record<string, string[]>, war?: WarPlan) {
  const orders: Record<string, ArmamentOrders> = Object.fromEntries(
    Object.keys(state.stateEconomies).map((id) => [id, { arms: 0, ammo: 0 }]),
  );
  function assign(owner: string, sources: string[], strength: number, field: boolean) {
    const nation = state.nations[owner];
    const { ordinaryWage } = laborProtection(nation.laws);
    const needs = equipmentNeeds(strength, field);
    for (const good of armamentGoods) {
      let remaining = good === "arms" ? needs.weapons : needs.ammunition;
      const spec = industries[good];
      // Reach staffed, stocked suppliers first. Orders placed beyond that output fund restocking.
      for (const id of sources) {
        if (remaining === 0) break;
        const local = state.stateEconomies[id];
        if (local.buildings[good] === 0) continue;
        const account = local.industrial!;
        const site = state.societies[id];
        const trained = Math.max(0, workForce(availableEngineers(site, owner, nation), site.laborParticipation) - site.university * universityJobs);
        const possible = Math.min(local.buildings[good] * spec.jobs, trainedLabourCapacity(good, trained),
          affordableIndustryWorkers(good, account.capital, undefined, 0, ordinaryWage));
        const employed = materialWorkers(good, possible, account.stocks);
        const capacity = Math.floor(employed * spec.output * unrestEffects(site.stability).output / spec.jobs);
        const assigned = Math.min(Math.max(0, capacity - orders[id][good]), remaining);
        orders[id][good] += assigned;
        remaining -= assigned;
      }
      for (const id of sources) {
        if (remaining === 0) break;
        const capacity = state.stateEconomies[id].buildings[good] * spec.output;
        const assigned = Math.min(capacity - orders[id][good], remaining);
        orders[id][good] += assigned;
        remaining -= assigned;
      }
    }
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const { treasury, fiscal } = state.countryEconomies[owner];
    if (Math.max(0, treasury) + availablePrepaymentCredit(fiscal, treasury) === 0) continue;
    const regulars = (sites: string[]) => sites.reduce((sum, id) =>
      sum + garrisonSize(state.societies[id], state.stateEconomies[id].population), 0);
    const route = war?.routes[owner];
    if (route) {
      const { front, rear } = militarySources(ids, route);
      const rearRegulars = regulars(rear);
      const deployed = regulars(ids) - rearRegulars;
      const mobilized = !route.mobilized ? 0 : [...route.recruitmentStates].reduce((sum, id) => {
        const site = state.societies[id];
        const eligible = workForce(state.stateEconomies[id].population, site.laborParticipation) -
          bondedRuralWorkers(ruralPopulation(site.pops), site.laborParticipation, state.nations[owner].laws);
        return sum + Math.min(Math.floor(site.conscription * 500 * siteMilitaryShare(site)),
          Math.floor(eligible * war!.recruitPercent / 100));
      }, 0);
      assign(owner, front, deployed + mobilized, true);
      assign(owner, rear, rearRegulars, false);
    } else {
      assign(owner, ids, regulars(ids), false);
    }
  }
  return orders;
}

// Add this force's issues to the national report, returning its own fulfilment for combat.
function issueSupplies(
  military: MilitarySupply, contract: SupplyContract, stocks: Record<string, ByGood<number>>, sources: string[],
  regulars: number, fieldStrength: number, campaignGrain: number, transport: number, grainShare: number, overseas = false,
) {
  function pay(id: string, good: keyof MilitaryGoods, units: number) {
    if (units === 0) return;
    const price = units * contract.prices[good];
    contract.cash -= price;
    contract.spending[good] += price;
    contract.proceeds.set(id, (contract.proceeds.get(id) ?? 0) + price);
  }
  const demand = regulars + campaignGrain;
  const grain = sources.reduce((total, id) => total + stocks[id].grain, 0);
  const delivered = Math.min(demand, transport, Math.floor(grain * grainShare), Math.floor(contract.cash / contract.prices.grain));
  military.grainDemand += demand;
  military.grainDrawn += delivered;
  military.grainTransport += Math.min(transport, grain);
  let readiness = demand ? delivered / demand : 1;
  let cumulative = 0, allocated = 0;
  for (const id of sources) {
    cumulative += stocks[id].grain;
    const share = grain ? Math.floor(delivered * cumulative / grain) : 0;
    stocks[id].grain -= share - allocated;
    pay(id, "grain", share - allocated);
    allocated = share;
  }
  const needs = equipmentNeeds(fieldStrength > 0 ? fieldStrength : regulars, fieldStrength > 0);
  let seaCargo = delivered;
  for (const kind of ["weapons", "ammunition", "uniforms"] as const) {
    const good = equipmentGoods[kind];
    let issued = 0;
    const limit = Math.min(overseas ? transport - seaCargo : transport, needs[kind],
      Math.floor(contract.cash / contract.prices[good]));
    for (const id of sources) {
      const take = Math.min(limit - issued, stocks[id][good]);
      stocks[id][good] -= take;
      pay(id, good, take);
      issued += take;
      if (issued === limit) break;
    }
    military.equipment[kind].demand += needs[kind];
    military.equipment[kind].delivered += issued;
    seaCargo += issued;
    if (needs[kind]) readiness = Math.min(readiness, issued / needs[kind]);
  }
  if (overseas) military.seaCargoUsed = seaCargo;
  return readiness;
}

function fleetPlans(state: GameState, holdings: Record<string, string[]>, scenario?: Scenario) {
  return Object.fromEntries(Object.entries(holdings).map(([owner, ids]) => {
    const { fleet, convoys } = state.nations[owner];
    const ports = ids.filter((id) => state.occupation?.stateId !== id && (scenario
      ? scenario.states[id].coastal : state.stateEconomies[id].buildings.shipGoods > 0 || state.societies[id].port > 0));
    const order = fleet.order;
    const port = order && ids.includes(order.stateId) && state.occupation?.stateId !== order.stateId ? order.stateId :
      fleet.motorizationPort && ids.includes(fleet.motorizationPort) && state.occupation?.stateId !== fleet.motorizationPort
        ? fleet.motorizationPort :
      ports.sort((a, b) => state.stateEconomies[b].buildings.shipGoods - state.stateEconomies[a].buildings.shipGoods ||
        state.societies[b].port - state.societies[a].port || state.stateEconomies[b].population - state.stateEconomies[a].population)[0] ?? null;
    const risk = state.countryEconomies[owner].fiscal?.week.risk;
    const places = port !== null && risk !== "restricted" && risk !== "defaulted" ? 1 + state.societies[port].port : 0;
    const berths = order && port === order.stateId ? Math.min(order.remaining, places) : 0;
    const refits = port !== null && port === fleet.motorizationPort ? Math.min(convoys - fleet.motorized, places - berths) : 0;
    const need = fleetMaintenance(convoys);
    const buffer = fleet.stores <= need * 2 ? need * 8 : need;
    const fuelDemand = fleet.motorized + refits;
    const requested = {
      shipGoods: port === null ? 0 : Math.max(0, buffer + berths * shipGoodsPerConvoy + refits * shipGoodsPerMotor - fleet.stores),
      oil: port === null || fleet.oil >= fuelDemand ? 0 : Math.max(0, fuelDemand * 4 - fleet.oil),
      rubber: Math.max(0, refits * rubberPerMotor - fleet.rubber),
    };
    return [owner, { port, berths, refits, requested, ordered: byFleetGood(() => 0),
      delivered: byFleetGood(() => 0), spending: byFleetGood(() => 0) }];
  }));
}

function fleetIndustryOrders(state: GameState, plans: ReturnType<typeof fleetPlans>, good: FleetGood) {
  const demand = new Map<string, number>();
  const offers = new Map<string, number>();
  for (const [owner, plan] of Object.entries(plans)) {
    const market = marketOf(state, owner);
    const funded = Math.min(plan.requested[good], Math.floor(Math.max(0, state.countryEconomies[owner].treasury) /
      industries[good].basePrice));
    offers.set(owner, funded);
    demand.set(market, (demand.get(market) ?? 0) + funded);
  }
  const imports = new Map<string, number>();
  for (const route of state.tradeRoutes ?? []) {
    if (route.good !== good || route.paused || state.ownerByStateId[route.from] !== route.exporter ||
        plans[route.importer].port !== route.to) continue;
    const requested = Math.min(route.limit, offers.get(route.importer)!);
    imports.set(route.from, (imports.get(route.from) ?? 0) + requested);
  }
  const orders = new Map<string, number>();
  const suppliers = Object.entries(state.stateEconomies).flatMap(([id, local]) => {
    if (local.buildings[good] === 0) return [];
    const industry = industries[good], account = local.industrial!;
    const ready = Math.floor(materialWorkers(good, Math.min(local.buildings[good] * industry.jobs,
      affordableIndustryWorkers(good, account.capital)), account.stocks) * industry.output / industry.jobs);
    return [{ id, market: marketOf(state, state.ownerByStateId[id]), ready, limit: local.buildings[good] * industry.output }];
  });
  for (const stage of ["ready", "limit"] as const) {
    for (const { id, market, ready, limit } of suppliers) {
      const ordered = orders.get(id) ?? 0;
      const available = (stage === "ready" ? ready : limit) - ordered;
      const needed = demand.get(market) ?? 0;
      const assigned = Math.min(needed, available);
      demand.set(market, needed - assigned);
      orders.set(id, ordered + assigned);
    }
  }
  for (const { id, limit } of suppliers) {
    orders.set(id, Math.min(limit, orders.get(id)! + (imports.get(id) ?? 0)));
  }
  return orders;
}

export function projectEconomy(state: GameState, war?: WarPlan, scenario?: Scenario): EconomyReport {
  return projectSettlement(state, war, undefined, scenario).report;
}

function projectSettlement(state: GameState, war?: WarPlan, closingTick?: number, scenario?: Scenario) {
  const report: EconomyReport = { states: {}, countries: {} };
  const taxPolicies = Object.fromEntries(Object.entries(state.nations).map(([id, nation]) => [id, taxPolicy(nation)]));
  const privateIncomes: Record<string, HouseholdIncome> = {};
  const markets: Record<string, ByGood<Market>> = {};
  const holdings: Record<string, string[]> = {};
  const marketSites: Record<string, string[]> = {};
  const supplies: Record<string, ByGood<number>> = {},
    demands: Record<string, ByGood<number>> = {},
    householdOrders: Record<string, ByGood<number>> = {},
    constructionOrders: Record<string, ByGood<number>> = {};
  const constructionCrews: Record<string, Record<ConstructionSector, number>> = {};
  const maintenancePlans: Record<string, ReturnType<typeof planConstructionMaintenance>> = {};
  const constructionClosing: Record<string, ConstructionStock> = {};
  const constructionNeeds: Record<string, Record<ConstructionSector, number>> = {};
  const privateConstructionCash: Record<string, number> = {};
  const productionStocks = new Map<string, { remaining: IndustrialAccount["stocks"]; skilledWages: number }>();
  const householdPlans = new Map<string, {
    basicBudget: number; discretionaryBudget: number; extra: ExtrasReport["orders"];
  }>();
  const officePlans = new Map<string, ReturnType<typeof planOffice>>();
  const institutionPlans = new Map<string, Record<Institution, ReturnType<typeof planInstitution>>>();
  const welfareReliefPlans = new Map<string, ReturnType<typeof planWelfareRelief>>();
  const cashToCommit = Object.fromEntries(Object.entries(state.countryEconomies)
    .map(([id, account]) => [id, Math.max(0, account.treasury)]));
  const industrialClosing: Record<string, IndustrialAccount> = {};
  for (const [id, nation] of Object.entries(state.nations)) {
    const market = byGood(() => ({ demand: 0, supply: 0, price: 0 }));
    markets[id] = market;
    marketSites[id] = [];
    holdings[id] = [];
    const work = (queue: Project[]) => Math.ceil(queue.reduce((points, project) =>
      points + (project.stateId === state.occupation?.stateId ? 0 : remainingProjectPoints(project)), 0) *
      constructionJobs / constructionPointsPerLevel);
    constructionNeeds[id] = { public: work(state.countryEconomies[id].queue), private: work(nation.privateQueue) };
    privateConstructionCash[id] = nation.investment;
    report.countries[id] = {
      market,
      ...getEconomicRules(nation),
      tax: 0,
      wageTaxGain: 0,
      taxReceipts: { system: taxPolicies[id].system, band: nation.taxBand, income: 0, excise: 0 },
      clothOutputGain: 0,
      investment: 0,
      capacity: 0,
      construction: emptyConstructionReport(),
      constructionMaintenance: { workers: 0, wages: 0, tools: 0, materials: 0 },
      tribute: 0,
      upkeep: 0,
      universityWages: 0,
      administrationWages: 0,
      officeUpkeep: 0,
      healthcareUpkeep: 0,
      policingUpkeep: 0,
      welfareUpkeep: 0,
      educationUpkeep: 0,
      tradeTariff: 0,
      tradeSeaCargo: 0,
      military: {
        regulars: 0,
        conscripts: 0,
        grainDemand: 0,
        grainDrawn: 0,
        grainTransport: 0,
        equipment: {
          weapons: { demand: 0, delivered: 0 },
          ammunition: { demand: 0, delivered: 0 },
          uniforms: { demand: 0, delivered: 0 },
        },
        readiness: 1,
      },
    };
  }
  for (const id of Object.keys(state.stateEconomies)) holdings[state.ownerByStateId[id]].push(id);
  const armamentOrders = planArmamentOrders(state, holdings, war);
  const fleets = fleetPlans(state, holdings, scenario);
  const fleetProduction = byFleetGood((good) => fleetIndustryOrders(state, fleets, good));
  for (const [id, local] of Object.entries(state.stateEconomies)) {
    const owner = state.ownerByStateId[id],
      nation = state.nations[owner],
      site = state.societies[id],
      c = report.countries[owner];
    const route = war?.routes[owner],
      front = route?.recruitmentStates.has(id);
    const effects = unrestEffects(site.stability);
    const militaryShare = siteMilitaryShare(site);
    const regulars = garrisonSize(site, local.population);
    const draftRate = front && route!.mobilized ? war!.recruitPercent : 0;
    const draftQuota = Math.floor(site.conscription * 500 * militaryShare);
    const engineers = availableEngineers(site, owner, nation);
    const participation = site.laborParticipation;
    const ruralPeople = ruralPopulation(site.pops);
    const boundToLand = bondedRuralWorkers(ruralPeople, participation, nation.laws);
    const workforce = workForce(local.population, participation);
    const labour = workforce - regulars - boundToLand;
    const specialists = workForce(engineers, participation);
    const universityStaff = Math.min(labour, specialists, site.university * universityJobs);
    const unassignedAfterUniversity = Math.min(labour - universityStaff, specialists - universityStaff);
    const { ordinaryWage } = laborProtection(nation.laws);
    const offices = state.occupation?.stateId === id ? 0 : site.bureaucracy;
    const office = planOffice(officeNeed(local.population, site, state.settings.difficulty, nation.laws),
      offices, unassignedAfterUniversity, cashToCommit[owner]);
    officePlans.set(id, office);
    cashToCommit[owner] -= office.reserved;
    const integration = site.governance?.integration;
    const administrationShare = integration && !front && state.occupation?.stateId !== id
      ? (closingTick === undefined ? 1 : integrationWeekShare(integration.startedAtTick, closingTick)) : 0;
    const administrators = administrationShare > 0
      ? Math.min(unassignedAfterUniversity - office.staff,
        integrationStaffNeeded(local.population, state.settings.difficulty))
      : 0;
    const administrationDue = Math.floor(administrators * administrationShare * administrationWage);
    const ceilings = orderQuoteCeilings(local, state.countryEconomies[marketOf(state, owner)]);
    let institutionStaff = 0;
    const institutionCapacity = state.occupation?.stateId === id ? 0 : unassignedAfterUniversity - office.staff - administrators;
    const services = byInstitution((kind) => {
      const level = Math.min(site[kind], institutionLawLimit(nation.laws, kind));
      const plan = planInstitution(kind, local.population, level, institutionCapacity - institutionStaff,
        cashToCommit[owner], ceilings);
      institutionStaff += plan.staff;
      cashToCommit[owner] -= plan.reserved;
      return plan;
    });
    institutionPlans.set(id, services);
    if (site.welfare > 0) {
      const relief = planWelfareRelief(site.pops, services.welfare, cashToCommit[owner]);
      welfareReliefPlans.set(id, relief);
      cashToCommit[owner] -= relief.reserved;
    }
    let workers = labour - universityStaff - administrators - office.staff - institutionStaff,
      conscripts = 0;
    const jobs = state.occupation?.stateId === id ? 0 : Math.min(workers, site.construction * constructionJobs);
    const need = constructionNeeds[owner];
    const stock = local.constructionStock ?? { public: crewMaterials(0), private: crewMaterials(0) };
    const crews = shareCrew(jobs, privateShareOf(nation),
      affordableCrew(Math.min(jobs, need.public), cashToCommit[owner], ceilings, stock.public),
      affordableCrew(Math.min(jobs, need.private), privateConstructionCash[owner], ceilings, stock.private));
    constructionCrews[id] = crews;
    cashToCommit[owner] -= reserveCrew(crews.public, ceilings, stock.public);
    privateConstructionCash[owner] -= reserveCrew(crews.private, ceilings, stock.private);
    for (const sector of constructionSectors) need[sector] -= crews[sector];
    const builders = crews.public + crews.private;
    const standby = planConstructionMaintenance(jobs - builders, cashToCommit[owner], ceilings.tools);
    maintenancePlans[id] = standby;
    cashToCommit[owner] -= standby.reserved;
    workers -= builders + standby.workers;
    const fleet = fleets[owner];
    if (fleet.port === id) for (const good of fleetGoods) {
      const ordered = Math.min(fleet.requested[good], Math.floor(cashToCommit[owner] / ceilings[good]));
      fleet.ordered[good] = ordered;
      cashToCommit[owner] -= ordered * ceilings[good];
    }
    const account = local.industrial;
    let payrollBudget = account?.capital ?? 0;
    const remaining = account ? { ...account.stocks } : byIndustrialGood(() => 0);
    const restock = byIndustrialGood(() => 0);
    let technicians = specialists - universityStaff - administrators - office.staff - institutionStaff;
    let skilledWages = 0;
    const retrofitting = new Set(state.countryEconomies[owner].queue
      .filter((job) => job.stateId === id && job.weeksLeft < projects[job.good].weeks)
      .map((job) => job.good));
    const activeElectric = (good: Good) => (good === "tools" || good === "steel") && site[electricRetrofits[good]] === 1;
    const powerDemand = electricIndustries.reduce((sum, good) => sum +
      (activeElectric(good) ? local.buildings[good] * industryMethod(good, true).power : 0), 0);
    let powerLeft = 0, powerRequested = 0, powerUsed = 0;
    const access = Math.min(
      1,
      ((site.infrastructure + site.railway * railCapacityPerLevel) * 11000) /
        (local.population + 2000 * (local.buildings.cloth / commercialLevels.cloth + local.buildings.grain / commercialLevels.grain) +
          250 * (local.buildings.wood + local.buildings.iron + local.buildings.coal + local.buildings.tools + local.buildings.paper)),
    ) * effects.transport;
    function produce(g: Good): IndustryReport {
      if ((g === "tools" || g === "steel") && retrofitting.has(electricRetrofits[g])) return { employed: 0, output: 0, wages: 0 };
      const electric = activeElectric(g);
      const spec = industryMethod(g, electric);
      const ordered = g === "arms" || g === "ammo" ? armamentOrders[id][g] :
        isFleetGood(g) ? fleetProduction[g].get(id) ?? 0 : g === "electricity" ? powerDemand : Infinity;
      const civilianTarget = Math.ceil(ordered * spec.jobs / (spec.output * effects.output));
      const orderedJobs = civilianTarget === 0 ? 0 : Math.min(civilianTarget + draftQuota - conscripts,
        Math.ceil(civilianTarget * 100 / (100 - draftRate)));
      const jobs = Math.min(
        workers,
        local.buildings[g] * spec.jobs,
        orderedJobs,
        trainedLabourCapacity(g, technicians, spec),
        affordableIndustryWorkers(g, payrollBudget, spec, ceilings.electricity, ordinaryWage),
      );
      const drafted = Math.min(draftQuota - conscripts, Math.floor(jobs * draftRate / 100));
      conscripts += drafted;
      const civilianJobs = jobs - drafted;
      const powerLimit = electric ? Math.floor(powerLeft * spec.jobs / spec.power) : civilianJobs;
      if (electric) powerRequested += electricityUse(spec, materialWorkers(g, civilianJobs, remaining, spec));
      const employed = operateIndustry(g, civilianJobs, remaining, restock, spec, powerLimit);
      const electricity = electricityUse(spec, employed);
      powerLeft -= electricity;
      powerUsed += electricity;
      workers -= employed + drafted;
      const payroll = industrialPayroll(g, employed, spec, ordinaryWage);
      payrollBudget -= payroll.total + electricity * ceilings.electricity;
      technicians -= payroll.skilled;
      skilledWages += payroll.skilledWages;
      const base = Math.floor((employed * spec.output * effects.output) / spec.jobs);
      const output = g === "cloth" ? Math.floor((base * (100 + c.clothOutputBonus)) / 100) : base;
      if (g === "cloth") c.clothOutputGain += output - base;
      return { employed, output, wages: payroll.total, ...(electric ? { electric: true } : {}) };
    }
    const suppliesFirst = { grain: produce("grain"), cloth: produce("cloth"),
      arms: produce("arms"), ammo: produce("ammo"), shipGoods: produce("shipGoods"), electricity: produce("electricity") };
    powerLeft = suppliesFirst.electricity.output;
    const activity = byGood((g) => Object.hasOwn(suppliesFirst, g) ? suppliesFirst[g as keyof typeof suppliesFirst] : produce(g));
    c.military.regulars += regulars;
    c.military.conscripts += conscripts;
    c.universityWages! += universityStaff * universityWage;
    c.administrationWages! += administrationDue;
    c.upkeep += regulars * 12 + universityStaff * universityWage + administrationDue + office.wages;
    supplies[id] = byGood((g) => activity[g].output);
    const essentialNeeds = byGood((g) => Math.round(local.population * industries[g].demandPerPerson));
    const subsistence = local.cropland === undefined ? undefined : subsistenceHarvest(
      local.cropland, local.buildings, ruralPeople, workers + boundToLand, workForce(ruralPeople, participation),
      effects.output, rentRateOf(nation),
    );
    const marketNeeds = subsistence ? { ...essentialNeeds,
      grain: essentialNeeds.grain - subsistence.retained.grain,
      wood: essentialNeeds.wood - subsistence.retained.wood,
    } : essentialNeeds;
    const publicMaterials = materialOrder(crews.public, stock.public), privateMaterials = materialOrder(crews.private, stock.private);
    publicMaterials.tools += standby.tools;
    const construction = byGood((g) => g === "wood" || g === "tools" || g === "iron" ?
      publicMaterials[g] + privateMaterials[g] : 0);
    const funded = account ? fundedRestock(payrollBudget, remaining, restock) : byIndustrialGood(() => 0);
    const expectedSupply = subsistence ? { ...supplies[id],
      grain: supplies[id].grain + subsistence.produced.grain - subsistence.retained.grain,
      wood: supplies[id].wood + subsistence.produced.wood - subsistence.retained.wood,
    } : supplies[id];
    const basic = planBasicBasket(marketNeeds, expectedSupply,
      local.localQuotes ?? byGood((g) => industries[g].basePrice), funded.coal);
    const { orders: household, basicBudget, discretionaryBudget } =
      fundBasicBasket(basic, ceilings, local.basicBudget, local.discretionaryBudget ?? 0);
    const extra = extrasOrders(local.population, discretionaryBudget, (good) => exciseOn(taxPolicies[owner], good));
    if (account) productionStocks.set(id, { remaining, skilledWages });
    householdOrders[id] = household;
    householdPlans.set(id, { basicBudget, discretionaryBudget, extra });
    constructionOrders[id] = construction;
    demands[id] = byGood((g) => household[g] + (isExtraGood(g) ? extra[g] : 0) + construction[g] +
      (isIndustrialGood(g) ? funded[g] : 0) +
      (isInstitutionGood(g) ? institutions.reduce((units, kind) => units + services[kind].orders[g], 0) : 0) +
      (g === "paper" ? office.paperDemand : g === "services" ? office.serviceDemand :
        isFleetGood(g) && fleet.port === id ? fleet.ordered[g] : g === "electricity" ? powerUsed : 0));
    report.states[id] = {
      industries: activity,
      workforce,
      ...(powerDemand > 0 || local.buildings.electricity > 0 ?
        { power: { requested: powerRequested, delivered: powerUsed, spending: 0 } } : {}),
      householdBasicOrders: essentialNeeds,
      householdSubstituteOrders: { food: household.food, coal: household.coal },
      ...(subsistence ? { subsistence } : {}),
      regulars,
      universityStaff,
      administrationStaff: administrationDue / administrationWage,
      builders,
      conscripts,
      access,
      localPrices: byGood(() => 0),
      dividends: 0,
      investment: 0,
    };
  }
  const militaryCargo = new Map<string, number>();
  const militaryPortUse = new Map<string, number>();
  const militaryReceipts = new Map<string, number>();
  const blockadedPorts = new Set<string>();
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      route = war?.routes[owner];
    const marketId = marketOf(state, owner),
      m = c.military,
      pool = markets[marketId];
    const priorPrices = state.countryEconomies[marketId].referenceQuotes;
    const { fiscal, treasury } = state.countryEconomies[owner];
    const contract: SupplyContract = {
      cash: cashToCommit[owner] + availablePrepaymentCredit(fiscal, treasury),
      prices: {
        grain: Math.round(priorPrices?.grain ?? industries.grain.basePrice),
        cloth: Math.round(priorPrices?.cloth ?? industries.cloth.basePrice),
        arms: Math.round(priorPrices?.arms ?? industries.arms.basePrice),
        ammo: Math.round(priorPrices?.ammo ?? industries.ammo.basePrice),
      },
      spending: { grain: 0, cloth: 0, arms: 0, ammo: 0 }, proceeds: militaryReceipts,
    };
    if (route) {
      const { front, rear } = militarySources(ids, route);
      const rearRegulars = rear.reduce((sum, id) => sum + report.states[id].regulars, 0);
      const deployed = m.regulars - rearRegulars;
      const fieldStrength = deployed + m.conscripts;
      m.readiness = issueSupplies(
        m, contract, supplies, front,
        deployed, fieldStrength, fieldStrength * war!.grainPerRecruit, route.grainTransport, war!.supplyPercent / 100, route.overseas,
      );
      if (route.overseas) {
        const cargo = m.seaCargoUsed!;
        militaryCargo.set(owner, cargo);
        for (const terminals of route.maritimeTerminals ?? []) {
          let remaining = cargo;
          // A raid interrupts forward ports; the recruitment depot is the rear
          // port and remains available for trade unless it is the only terminal.
          const forwardPorts = terminals.filter(({ stateId }) => !route.recruitmentStates.has(stateId));
          if (route.raided)
            for (const { stateId } of forwardPorts.length > 0 ? forwardPorts : terminals.slice(0, 1))
              blockadedPorts.add(stateId);
          for (const { stateId, capacity } of terminals) {
            if (remaining === 0) break;
            const handled = Math.min(remaining, capacity);
            militaryPortUse.set(stateId, handled);
            report.states[stateId].portMilitaryCargo = handled;
            remaining -= handled;
          }
        }
      }
      if (route.raided && (!route.maritimeTerminals || route.maritimeTerminals.length === 0))
        for (const stateId of route.recruitmentStates) blockadedPorts.add(stateId);
      // Rear garrisons draw from the remaining domestic output, outside the front's transport limit.
      if (rearRegulars > 0) issueSupplies(m, contract, supplies, rear, rearRegulars, 0, 0, Infinity, 1);
    } else {
      m.readiness = issueSupplies(m, contract, supplies, ids, m.regulars, 0, 0, Infinity, 1);
    }
    m.procurement = contract.spending;
    c.upkeep += militaryProcurementCost(contract.spending);
    for (const id of ids) {
      const subsistence = report.states[id].subsistence;
      if (subsistence) {
        supplies[id].grain += subsistence.produced.grain - subsistence.retained.grain;
        supplies[id].wood += subsistence.produced.wood - subsistence.retained.wood;
      }
      marketSites[marketId].push(id);
      for (const g of goods) {
        pool[g].supply += supplies[id][g];
        pool[g].demand += g === "electricity" ? report.states[id].power?.requested ?? 0 : demands[id][g];
      }
    }
  }
  const fills = byGood((): Record<string, MarketFill> => ({}));
  const referenceQuotes: Record<string, ByGood<number>> = {};
  const localQuotes: Record<string, ByGood<number>> = {};
  const expected = expectedTrade(state);
  for (const [marketId, market] of Object.entries(markets)) {
    const sites = marketSites[marketId];
    const flow = expected.markets.get(marketId);
    referenceQuotes[marketId] = byGood((g) => {
      const good = market[g];
      const base = industries[g].basePrice;
      const target = targetPrice(base, good.supply + (flow?.[g].incoming ?? 0), good.demand + (flow?.[g].outgoing ?? 0));
      const quote = nextPrice(state.countryEconomies[marketId].referenceQuotes?.[g] ?? base, target);
      good.targetPrice = Math.round(target);
      good.price = Math.round(quote);
      const clearing = clearMarket(sites.map((id) => ({
        supply: supplies[id][g], demand: demands[id][g], access: isLocalGood(g) ? 0 : report.states[id].access,
      })));
      good.traded = clearing.traded;
      sites.forEach((id, index) => { fills[g][id] = clearing.fills[index]; });
      return quote;
    });
  }
  for (const [id, site] of Object.entries(report.states)) {
    const market = markets[marketOf(state, state.ownerByStateId[id])];
    const flow = expected.sites.get(id);
    localQuotes[id] = byGood((g) => {
      const base = industries[g].basePrice;
      const requested = g === "electricity" ? site.power?.requested ?? 0 : demands[id][g];
      const target = targetPrice(base, supplies[id][g] + (flow?.[g].incoming ?? 0), requested + (flow?.[g].outgoing ?? 0));
      return nextPrice(state.stateEconomies[id].localQuotes?.[g] ?? base, target);
    });
    site.localPrices = byGood((g) => {
      const marketShare = isLocalGood(g) ? 0 : site.access;
      return Math.round(marketShare * market[g].price + (1 - marketShare) * Math.round(localQuotes[id][g]));
    });
  }
  const trade = state.tradeRoutes?.length
    ? settleTrade(state, supplies, demands, report.states, fills, militaryCargo, blockadedPorts, militaryPortUse)
    : undefined;
  if (trade) {
    report.trade = trade.deliveries;
    for (const [id, cargo] of trade.seaCargo) report.countries[id].tradeSeaCargo = cargo;
    for (const [id, cargo] of trade.portFreight) report.states[id].portTradeCargo = cargo;
  }
  for (const [owner, ids] of Object.entries(holdings)) {
    const c = report.countries[owner],
      nation = state.nations[owner];
    const { ordinaryWage } = laborProtection(nation.laws);
    c.market = markets[marketOf(state, owner)];
    const rate =
      (nation.laws.includes("自由放任") ? 0.40 : nation.laws.includes("干预主义") ? 0.25 : 0.10) +
      (approval(nation, "地主") >= 10 || approval(nation, "实业家") >= 10 ? 0.05 : 0);
    const policy = taxPolicies[owner];
    const receipts = c.taxReceipts!;
    let capacity = 0;
    for (const id of ids) {
      const s = report.states[id],
        site = state.societies[id];
      const effects = unrestEffects(site.stability);
      const taxShare = siteTaxShare(site, id === state.occupation?.stateId);
      const transfer = trade?.transfers.get(id);
      const household = householdOrders[id];
      const { extra, basicBudget, discretionaryBudget } = householdPlans.get(id)!;
      const construction = constructionOrders[id];
      const office = officePlans.get(id)!;
      const services = institutionPlans.get(id)!;
      const local = state.stateEconomies[id];
      const account = local.industrial;
      const subsistence = s.subsistence;
      let industrialIncome = militaryReceipts.get(id) ?? 0, industrialSales = industrialIncome;
      const fillsByUse = byGood((g) => {
        const m = c.market[g],
          production = s.industries[g],
          { local: localTrade, poolBought, poolSold } = fills[g][id];
        const localPrice = Math.round(localQuotes[id][g]);
        const sold = localTrade + poolSold + (transfer?.sent[g] ?? 0);
        production.sold = sold;
        production.bought = localTrade + poolBought + (transfer?.received[g] ?? 0);
        let revenue = localTrade * localPrice + poolSold * m.price + (transfer?.producerPayment[g] ?? 0);
        if (sold > 0 && subsistence && harvestGood(g)) {
          const ruralSold = Math.floor(sold * (subsistence.produced[g] - subsistence.retained[g]) / supplies[id][g]);
          const ruralRevenue = Math.floor(revenue * ruralSold / sold);
          const rent = Math.floor(ruralRevenue * subsistence.rentRate / 100);
          subsistence.sold[g] = ruralSold;
          subsistence.landRent += rent;
          subsistence.householdIncome += ruralRevenue - rent;
          production.sold -= ruralSold;
          revenue -= ruralRevenue;
        }
        industrialSales += revenue;
        industrialIncome += revenue - production.wages;
        const demand = demands[id][g];
        const officeOrder = g === "paper" ? office.paperDemand : g === "services" ? office.serviceDemand : 0;
        const residentOrder = household[g] + (isExtraGood(g) ? extra[g] : 0);
        const residentGoods = demand ? Math.floor(production.bought * residentOrder / demand) : 0;
        const basicGoods = Math.min(residentGoods, household[g]);
        const civilianGoods = demand ? Math.floor(production.bought * (residentOrder + construction[g]) / demand) : 0;
        const fleet = fleets[owner];
        const institutionOrders = byInstitution((kind) => isInstitutionGood(g) ? services[kind].orders[g] : 0);
        const fleetOrder = isFleetGood(g) && fleet.port === id ? fleet.ordered[g] : 0;
        const publicOrder = institutions.reduce((units, kind) => units + institutionOrders[kind], officeOrder + fleetOrder);
        const privateGoods = publicOrder > 0 ? Math.floor(production.bought * (demand - publicOrder) / demand) : production.bought;
        const inputGoods = privateGoods - civilianGoods;
        const payment = localTrade * localPrice + poolBought * m.price + (transfer?.received[g] ?? 0) * s.localPrices[g];
        const paidByPrivate = production.bought > 0 ? Math.floor(payment * privateGoods / production.bought) : 0;
        const paidByHouseholdsAndConstruction = production.bought > 0
          ? Math.floor(payment * civilianGoods / production.bought) : 0;
        const residentCost = production.bought > 0 ? Math.floor(payment * residentGoods / production.bought) : 0;
        const basicCost = production.bought > 0 ? Math.floor(payment * basicGoods / production.bought) : 0;
        const civilianCost = production.bought > 0 ? Math.floor(payment * civilianGoods / production.bought) : 0;
        const publicGoods = production.bought - privateGoods;
        const publicCost = payment - paidByPrivate;
        const publicFill = deliverInstitutionOrders(institutionOrders, publicOrder, publicGoods, publicCost);
        return {
          residentGoods,
          extraGoods: residentGoods - basicGoods,
          basicCost,
          extraCost: residentCost - basicCost,
          constructionGoods: civilianGoods - residentGoods,
          constructionCost: civilianCost - residentCost,
          inputGoods,
          materialCost: paidByPrivate - paidByHouseholdsAndConstruction,
          publicGoods: publicFill.remainingGoods,
          publicCost: publicFill.remainingCost,
          institutions: publicFill.delivered,
        };
      });
      const officeCost = fillsByUse.paper.publicCost + fillsByUse.services.publicCost;
      s.office = deliverOffice(office, fillsByUse.paper.publicGoods, fillsByUse.services.publicGoods, officeCost);
      const collection = taxShare * (0.75 + 0.25 * s.office.coverage);
      c.upkeep += officeCost;
      c.officeUpkeep! += s.office.wages + officeCost;
      for (const kind of institutions) {
        const plan = services[kind];
        if (plan.level === 0) continue;
        const spending = institutionGoods.reduce((sum, good) => sum + fillsByUse[good].institutions[kind].paid, 0);
        const delivered = byInstitutionGood((good) => fillsByUse[good].institutions[kind].received);
        s[kind] = deliverInstitution(plan, delivered, spending, s.office.coverage);
        const paid = plan.wages + spending;
        c[`${kind}Upkeep`]! += paid;
        c.upkeep += paid;
      }
      if (s.welfare) {
        const relief = deliverWelfareRelief(welfareReliefPlans.get(id)!, s.welfare.coverage);
        s.welfareRelief = relief;
        const paid = relief.paid.农民 + relief.paid.劳工;
        c.welfareUpkeep! += paid;
        c.upkeep += paid;
      }
      if (s.power) s.power.spending = fillsByUse.electricity.materialCost;
      const fleet = fleets[owner];
      if (fleet.port === id) for (const good of fleetGoods) {
        fleet.delivered[good] = fillsByUse[good].publicGoods;
        fleet.spending[good] = fillsByUse[good].publicCost;
        c.upkeep += fleet.spending[good];
      }
      if (account) {
        const { remaining, skilledWages } = productionStocks.get(id)!;
        const bought = byIndustrialGood((g) => g === "electricity" ? 0 : fillsByUse[g].inputGoods);
        const inputCost = goods.reduce((sum, g) => sum + fillsByUse[g].materialCost, 0);
        const available = account.capital + industrialIncome - inputCost;
        if (available < 0) throw new Error("工商业采购超过已落实的周转资金");
        const methods = byGood((g) => industryMethod(g, s.industries[g].electric === true));
        const capital = Math.min(available, workingCapitalTarget(local.buildings, methods, ordinaryWage));
        const surplus = available - capital;
        const contribution = Math.floor(surplus * rate);
        s.investment += contribution;
        s.dividends += surplus - contribution;
        const stocks = byIndustrialGood((g) => remaining[g] + bought[g]);
        industrialClosing[id] = { capital, stocks };
        s.industrial = { ...industrialClosing[id], bought, used: byIndustrialGood((g) => account.stocks[g] - remaining[g]),
          spent: inputCost, sales: industrialSales, distributed: surplus, skilledWages };
      }
      if (transfer) {
        const reinvested = Math.floor(transfer.profit * rate);
        s.investment += reinvested;
        s.dividends += transfer.profit - reinvested;
        s.freightWages = transfer.freight;
        c.tradeTariff! += transfer.tariff;
      }
      const consumption = byGood((g) => fillsByUse[g].residentGoods + (subsistence && harvestGood(g) ? subsistence.retained[g] : 0));
      s.householdConsumption = consumption;
      const delivered = byExtraGood((g) => fillsByUse[g].extraGoods);
      const extraBills = Object.values(byExtraGood((good) => {
        const price = fillsByUse[good].extraCost;
        return { price, tax: Math.floor(price * exciseOn(policy, good) * collection) };
      }));
      const excise = extraBills.reduce((sum, bill) => sum + bill.tax, 0);
      const extraSpending = excise + extraBills.reduce((sum, bill) => sum + bill.price, 0);
      receipts.excise += excise;
      const basicSpending = goods.reduce((sum, g) => sum + fillsByUse[g].basicCost, 0);
      if (basicSpending > basicBudget) throw new Error("基本消费超过已落实的家庭资金");
      s.householdBasicPurchases = { budget: basicBudget, spending: basicSpending };
      if (extraSpending > discretionaryBudget) throw new Error("可选消费超过已落实的家庭资金");
      s.householdExtras = { budget: discretionaryBudget, orders: extra, delivered, spending: extraSpending };
      const crews = constructionCrews[id];
      const { workers: standbyWorkers, wages: standbyWages } = maintenancePlans[id];
      const maintenance = { workers: standbyWorkers, wages: standbyWages, tools: 0, materials: 0 };
      const stock = local.constructionStock ?? { public: crewMaterials(0), private: crewMaterials(0) };
      const publicOrder = materialOrder(crews.public, stock.public), privateOrder = materialOrder(crews.private, stock.private);
      const publicDelivered = crewMaterials(0), privateDelivered = crewMaterials(0);
      let publicMaterials = 0, privateMaterials = 0;
      for (const good of constructionMaterials) {
        const { constructionGoods: units, constructionCost: amount } = fillsByUse[good];
        const ordered = publicOrder[good] + privateOrder[good];
        const activeUnits = Math.min(units, ordered);
        if (good === "tools") {
          maintenance.tools = units - activeUnits;
          maintenance.materials = units ? Math.floor(amount * maintenance.tools / units) : 0;
        }
        const activeCost = amount - (good === "tools" ? maintenance.materials : 0);
        publicDelivered[good] = ordered ? Math.round(activeUnits * publicOrder[good] / ordered) : 0;
        privateDelivered[good] = activeUnits - publicDelivered[good];
        const paidPublic = activeUnits ? Math.floor(activeCost * publicDelivered[good] / activeUnits) : 0;
        publicMaterials += paidPublic;
        privateMaterials += activeCost - paidPublic;
      }
      const publicWork = deliverConstruction(crews.public, stock.public, publicDelivered, publicMaterials, effects.output);
      const privateWork = deliverConstruction(crews.private, stock.private, privateDelivered, privateMaterials, effects.output);
      s.construction = { public: publicWork.bill, private: privateWork.bill };
      s.constructionMaintenance = maintenance;
      const totalMaintenance = c.constructionMaintenance!;
      totalMaintenance.workers += maintenance.workers;
      totalMaintenance.wages += maintenance.wages;
      totalMaintenance.tools += maintenance.tools;
      totalMaintenance.materials += maintenance.materials;
      if (constructionMaterials.some((good) => publicWork.remaining[good] > 0 || privateWork.remaining[good] > 0)) {
        constructionClosing[id] = { public: publicWork.remaining, private: privateWork.remaining };
      }
      s.constructionGoods = byGood((good) => good === "wood" || good === "tools" || good === "iron" ?
        publicWork.used[good] + privateWork.used[good] : 0);
      for (const sector of constructionSectors) {
        const total = c.construction![sector], bill = s.construction[sector];
        total.wages += bill.wages;
        total.materials += bill.materials;
        total.points += bill.points;
      }
      c.upkeep += constructionSpending(s.construction.public) + constructionSpending(maintenance);
      const essentials = basicEquivalentSupply(s.householdConsumption, delivered);
      s.foodFulfillment = fulfillment(essentials.grain, s.householdBasicOrders!.grain);
      const acquiredValue = goods.reduce((sum, g) => sum + consumption[g] * industries[g].basePrice, 0);
      s.consumptionIndex = acquiredValue / (state.stateEconomies[id].population * basketBaseValue);
      c.investment += s.investment;
      const gross = privateHouseholdIncome(s);
      const paidTax = settleIncomeTax(gross, policy, collection);
      receipts.income += Object.values(paidTax).reduce((sum, value) => sum + value, 0);
      privateIncomes[id] = {
        农民: gross.农民 - paidTax.农民, 劳工: gross.劳工 - paidTax.劳工, 工程师: gross.工程师 - paidTax.工程师,
        资本家: gross.资本家 - paidTax.资本家, 贵族: gross.贵族 - paidTax.贵族,
      };
      if (policy.system === "工资税改革") c.wageTaxGain += Math.max(0,
        paidTax.劳工 + paidTax.工程师 - Math.floor((gross.劳工 + gross.工程师) * 0.1 * collection * policy.multiplier));
      capacity += s.construction.public.points + s.construction.private.points;
    }
    c.capacity = Math.floor(capacity * 100) / 100;
    c.tax = receipts.income + receipts.excise + c.tradeTariff!;
    if (nation.subjectType) c.tribute = Math.floor(c.tax * tributeRate[nation.subjectType]);
  }
  const fleetClosing = Object.fromEntries(Object.entries(fleets).map(([owner, plan]) => {
    const { convoys, fleet } = state.nations[owner];
    const { maintenanceDue, maintained, commissioned, converted, ...closing } =
      closeFleet(convoys, fleet, plan.delivered, plan.port, plan.berths, plan.refits);
    const cargo = (good: FleetGood) => ({ ordered: plan.ordered[good], delivered: plan.delivered[good], spending: plan.spending[good] });
    report.countries[owner].fleet = { port: plan.port, ...cargo("shipGoods"), maintenanceDue, maintained, commissioned,
      ...(fleet.motorizationPort || fleet.motorized > 0 ? { motorization: {
        converted, fueled: closing.fleet.fueled, oil: cargo("oil"), rubber: cargo("rubber"),
      } } : {}) };
    return [owner, closing];
  }));
  return { report, referenceQuotes, localQuotes, industrialClosing, constructionClosing, fleetClosing, privateIncomes };
}
export function buildingCapacity(site: Scenario["states"][string], local: StateEconomy, good: Good) {
  const inherited = good === "arms" || good === "ammo" ? local.inheritedArmamentCapacity?.[good] : undefined;
  return Math.max(inherited ?? 0, site.capacity[good] ?? 0);
}

export function constructionError(
  scenario: Scenario,
  state: GameState,
  countryId: string,
  stateId: string,
  good: Building,
  privateBuild = false,
) {
  if (state.playerCountryId === null) return "请先选择国家";
  if (state.ownerByStateId[stateId] !== countryId || !Object.hasOwn(state.stateEconomies, stateId))
    return "只能在本国州内建设";
  if (state.occupation?.stateId === stateId) return "该州处于军事占领中";
  const country = state.countryEconomies[countryId],
    nation = state.nations[countryId];
  if (good === "railway" && nation.knowledge["铁路"] !== 100) return "需要掌握铁路技术";
  if ((good === "electricity" || good === "electrifyTools" || good === "electrifySteel") &&
      nation.knowledge["电气化"] !== 100) return "需要掌握电气化技术";
  if (good === "electrifyTools" || good === "electrifySteel") {
    const industry = good === "electrifyTools" ? "tools" : "steel";
    if (state.stateEconomies[stateId].buildings[industry] === 0) return "需要已经投产的工厂";
    if (state.societies[stateId][good] === 1 || country.queue.some((p) => p.stateId === stateId && p.good === good))
      return "该州已经安排相同改造";
  }
  if (good === "port" && !scenario.states[stateId].coastal) return "只能在沿海州建设港口";
  if (good === "shipGoods" && !scenario.states[stateId].coastal) return "只能在沿海州建设造船厂";
  if (good === "oil" && nation.knowledge["内燃机"] !== 100) return "需要掌握内燃机技术";
  const fiscalRisk = country.fiscal?.week.risk;
  if (!privateBuild && (fiscalRisk === "restricted" || fiscalRisk === "defaulted"))
    return "公共支出不足，暂缓批准新工程";
  if (isGood(good)) {
    const local = state.stateEconomies[stateId];
    const queue = [...country.queue, ...nation.privateQueue].filter((p) => p.stateId === stateId);
    const queued = queue.reduce((count, project) => count + (project.good === good ? project.levels ?? 1 : 0), 0);
    if (local.buildings[good] + queued >= buildingCapacity(scenario.states[stateId], local, good))
      return "州内容量已满";
    if (local.cropland !== undefined && isCrop(good) &&
        reservedCropland(local.buildings, queue) + industries[good].jobs > local.cropland) return "可用耕地不足";
  } else if (privateBuild) return "私人资金限用于生产建筑";
  const ceilings = orderQuoteCeilings(state.stateEconomies[stateId], state.countryEconomies[marketOf(state, countryId)]);
  const stock = state.stateEconomies[stateId].constructionStock?.[privateBuild ? "private" : "public"] ?? crewMaterials(0);
  if ((privateBuild ? nation.investment : country.treasury) < projectDeposit(good) + reserveCrew(1, ceilings, stock)) return "资金不足";
}
export function chooseConstruction(
  scenario: Scenario,
  state: GameState,
  countryId: string,
  market: ByGood<Market>,
  privateBuild = false,
) {
  if ((privateBuild ? state.nations[countryId].privateQueue : state.countryEconomies[countryId].queue).length)
    return;
  const shortages = goods
    .filter((g) => market[g].demand > market[g].supply)
    .sort((a, b) => fulfillment(market[a].supply, market[a].demand) - fulfillment(market[b].supply, market[b].demand));
  for (const good of shortages)
    for (const id of Object.keys(state.stateEconomies)) {
      if (
        state.ownerByStateId[id] === countryId &&
        !constructionError(scenario, state, countryId, id, good, privateBuild)
      )
        return { stateId: id, good };
    }
}

export function chooseUniversity(scenario: Scenario, state: GameState, countryId: string) {
  if (state.countryEconomies[countryId].queue.length || state.elapsedDays % 28 !== 0 ||
      state.nations[countryId].research === null ||
      state.countryEconomies[countryId].treasury < projects.university.cost + 26 * universityJobs * universityWage) return;
  const owned = Object.keys(state.stateEconomies).filter((id) => state.ownerByStateId[id] === countryId);
  const population = owned.reduce((sum, id) => sum + state.stateEconomies[id].population, 0);
  const campuses = owned.reduce((sum, id) => sum + state.societies[id].university, 0);
  const target = Math.min(10, Math.max(1, Math.floor(population / 100_000)));
  if (campuses >= target) return;
  const site = owned.filter((id) => state.societies[id].university === 0)
    .sort((a, b) => state.stateEconomies[b].population - state.stateEconomies[a].population)[0];
  if (site && !constructionError(scenario, state, countryId, site, "university"))
    return { stateId: site, good: "university" as const };
}

export function chooseRailway(scenario: Scenario, state: GameState, countryId: string, report: EconomyReport) {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < projects.railway.cost ||
      state.nations[countryId].knowledge["铁路"] !== 100) return;
  const owned = Object.keys(state.stateEconomies).filter((id) => state.ownerByStateId[id] === countryId);
  const candidates = owned.flatMap((id) => {
    if (state.societies[id].railway > 0 || constructionError(scenario, state, countryId, id, "railway")) return [];
    const neighbors = scenario.states[id].neighbors.filter((neighbor) =>
      state.ownerByStateId[neighbor] === countryId && state.occupation?.stateId !== neighbor);
    if (neighbors.length === 0) return [];
    const connected = neighbors.some((neighbor) => state.societies[neighbor].railway > 0);
    const access = report.states[id].access;
    return access < 0.85 || connected ? [{ id, connected, access }] : [];
  }).sort((left, right) => Number(right.connected) - Number(left.connected) || left.access - right.access);
  if (candidates.length > 0) return { stateId: candidates[0].id, good: "railway" as const };
}

export function choosePort(scenario: Scenario, state: GameState, countryId: string, report: EconomyReport) {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < projects.port.cost) return;
  const candidates = Object.entries(report.states).flatMap(([id, site]) => {
    if (state.ownerByStateId[id] !== countryId || !scenario.states[id].coastal ||
        constructionError(scenario, state, countryId, id, "port")) return [];
    const capacity = portCapacity(scenario.states[id].grainTransport, state.societies[id]);
    const utilized = (site.portTradeCargo ?? 0) + (site.portMilitaryCargo ?? 0);
    return utilized > 0 && utilized >= capacity * 0.8 ? [{ id, utilized }] : [];
  }).sort((left, right) => right.utilized - left.utilized);
  if (candidates.length > 0) return { stateId: candidates[0].id, good: "port" as const };
}

export function chooseElectrification(scenario: Scenario, state: GameState, countryId: string): Pick<Project, "stateId" | "good"> | undefined {
  const country = state.countryEconomies[countryId];
  if (country.queue.length || state.elapsedDays % 28 !== 0 || country.treasury < projects.electricity.cost ||
      state.nations[countryId].knowledge["电气化"] !== 100) return;
  const districts = Object.entries(state.stateEconomies).filter(([id, local]) =>
    state.ownerByStateId[id] === countryId && (local.buildings.tools > 0 || local.buildings.steel > 0))
    .sort(([, a], [, b]) => b.buildings.steel + b.buildings.tools - a.buildings.steel - a.buildings.tools);
  for (const [stateId, local] of districts) {
    const retrofit = electricIndustries.map((good) => electricRetrofits[good])
      .find((good) => !constructionError(scenario, state, countryId, stateId, good));
    if (retrofit === undefined) continue;
    const good = local.buildings.electricity > 0 ? retrofit : "electricity";
    if (!constructionError(scenario, state, countryId, stateId, good)) return { stateId, good };
  }
}

export function settleEconomy(state: GameState, war?: WarPlan, fractionOfYear = 7 / 365, scenario?: Scenario): GameState & { lastEconomy: EconomyReport } {
  const closingTick = elapsedTicks(state);
  const tuning = ruleTuning(state.settings);
  const stateEconomies = { ...state.stateEconomies },
    societies = { ...state.societies },
    countryEconomies = { ...state.countryEconomies },
    nations = { ...state.nations };
  // A project completed from this week's deliveries starts operating next week.
  const { report: production, referenceQuotes, localQuotes, industrialClosing, constructionClosing, fleetClosing, privateIncomes } = projectSettlement(
    state, war, closingTick, scenario,
  );
  const budgets = weeklyBudgets(nations, production);
  const campusFunding: Record<string, number> = {};
  const administrationFunding: Record<string, number> = {};
  const militaryPayroll: Record<string, { paid: number; regulars: number; served: number; allocated: number }> = {};
  for (const [id, c] of Object.entries(production.countries)) {
    const country = countryEconomies[id];
    const construction = c.construction!;
    const prepaidUpkeep = c.officeUpkeep! + institutions.reduce((sum, kind) => sum + c[`${kind}Upkeep`]!, 0) +
      militaryProcurementCost(c.military.procurement) +
      constructionSpending(construction.public) + constructionSpending(c.constructionMaintenance!) + fleetSpending(c.fleet!);
    const closing = settleFiscal({
      day: state.elapsedDays, treasury: country.treasury, fiscal: country.fiscal,
      tax: c.tax, receipts: budgets[id].balance + c.upkeep, upkeep: c.upkeep,
      prepaidUpkeep,
      fractionOfYear, difficulty: state.settings.difficulty,
    });
    const { week } = closing.fiscal;
    const universityDue = c.universityWages!;
    const administrationDue = c.administrationWages!;
    const civilianDue = universityDue + administrationDue;
    const remainingDue = c.upkeep - prepaidUpkeep;
    const remainingPaid = week.upkeepPaid - prepaidUpkeep;
    const militaryDue = remainingDue - civilianDue;
    const universityPaid = remainingDue > 0 ? Math.floor(remainingPaid * universityDue / remainingDue) : 0;
    const civilianPaid = remainingDue > 0 ? Math.floor(remainingPaid * civilianDue / remainingDue) : 0;
    const administrationPaid = civilianPaid - universityPaid;
    c.universityWages = universityPaid;
    c.administrationWages = administrationPaid;
    campusFunding[id] = universityDue > 0 ? universityPaid / universityDue : 0;
    administrationFunding[id] = administrationDue > 0 ? administrationPaid / administrationDue : 0;
    const militaryPaid = remainingPaid - civilianPaid;
    militaryPayroll[id] = { paid: militaryPaid, regulars: c.military.regulars, served: 0, allocated: 0 };
    if (militaryDue > 0) c.military.readiness *= Math.min(1, militaryPaid / militaryDue);
    c.upkeep = week.upkeepPaid;
    c.interestPaid = week.interestPaid;
    countryEconomies[id] = {
      ...country,
      ...closing,
      referenceQuotes: referenceQuotes[marketOf(state, id)],
    };
    const morale = war?.routes[id]
      ? Math.min(
          100,
          Math.max(0, nations[id].morale + 12 * c.military.readiness - 18 * (1 - c.military.readiness)),
        )
      : Math.min(100, nations[id].morale + 8);
    nations[id] = { ...nations[id], ...fleetClosing[id], morale,
      investment: nations[id].investment - constructionSpending(construction.private) + c.investment };
  }
  for (const [id, s] of Object.entries(production.states)) {
    const owner = state.ownerByStateId[id];
    s.universityStaff! *= campusFunding[owner];
    s.administrationStaff! *= administrationFunding[owner];
    const site = societies[id];
    const earned = privateIncomes[id];
    const publicSpecialistWages = s.universityStaff! * universityWage + s.administrationStaff! * administrationWage +
      s.office!.wages + institutions.reduce((sum, kind) => sum + (s[kind]?.wages ?? 0), 0);
    const construction = s.construction!;
    const standby = s.constructionMaintenance!;
    const publicConstructionWages = construction.public.wages + standby.wages;
    const payroll = militaryPayroll[owner];
    payroll.served += s.regulars;
    const assigned = payroll.regulars ? Math.floor(payroll.paid * payroll.served / payroll.regulars) : 0;
    const armyWages = assigned - payroll.allocated;
    payroll.allocated = assigned;
    const jobs = goods.reduce((sum, good) => sum + s.industries[good].employed, s.builders + standby.workers);
    const subsistence = s.subsistence;
    const retainedValue = subsistence ? subsistence.retained.grain * s.localPrices.grain + subsistence.retained.wood * s.localPrices.wood : 0;
    const relief = s.welfareRelief?.paid;
    const basicCost = goods.reduce((sum, good) => sum + industries[good].demandPerPerson * s.localPrices[good], 0) +
      substitutedBasketCost(s.localPrices, s.householdSubstituteOrders!) / stateEconomies[id].population;
    const income = allocateHouseholdIncome(site.pops, basicCost, {
      ...earned,
      农民: earned.农民 + (relief?.农民 ?? 0),
      劳工: earned.劳工 + armyWages + publicConstructionWages + (relief?.劳工 ?? 0),
      工程师: earned.工程师 + publicSpecialistWages,
    }, retainedValue);
    const basic = s.householdBasicPurchases!;
    const extra = s.householdExtras!;
    const { constructionStock: _priorStock, ...local } = stateEconomies[id];
    stateEconomies[id] = { ...local, localQuotes: localQuotes[id],
      basicBudget: basic.budget - basic.spending + income.basic,
      discretionaryBudget: extra.budget - extra.spending + income.discretionary,
      ...(Object.hasOwn(constructionClosing, id) ? { constructionStock: constructionClosing[id] } : {}),
      ...(Object.hasOwn(industrialClosing, id) ? { industrial: industrialClosing[id] } : {}) };
    const governance = site.governance;
    if (governance?.integration) {
      societies[id] = { ...site, governance: advanceIntegration(
        governance, s.administrationStaff!, integrationStaffNeeded(stateEconomies[id].population, state.settings.difficulty),
        s.access * (1 - (site.stability?.unrest ?? 0) / 250) * (0.75 + 0.25 * s.office!.coverage), fractionOfYear,
      ) };
    }
    societies[id] = evolvePops(societies[id], owner, nations[owner], {
      grainPrice: s.localPrices.grain,
      laborWages: earned.劳工 + armyWages + publicConstructionWages,
      specialistWages: earned.工程师 + publicSpecialistWages,
      ruralResources: retainedValue + earned.农民,
      capitalistIncome: earned.资本家, landownerIncome: earned.贵族,
      businessJobs: jobs,
      standardTarget: livingStandardTarget(s.consumptionIndex!, s.foodFulfillment!),
      relief,
    }, tuning);
  }
  function complete<T extends Project>(queue: T[], points: number) {
    const remaining: T[] = [];
    for (const job of queue) {
      if (points === 0 || job.stateId === state.occupation?.stateId) {
        remaining.push(job);
        continue;
      }
      const required = remainingProjectPoints(job);
      if (points < required) {
        remaining.push({ ...job, weeksLeft: (required - points) * projects[job.good].weeks / projectPoints(job.good) });
        points = 0;
        continue;
      }
      points -= required;
      const { stateId, good } = job;
      if (isGood(good)) {
        const local = stateEconomies[stateId];
        const industrial = local.industrial ?? emptyIndustrialAccount();
        stateEconomies[stateId] = {
          ...local,
          buildings: { ...local.buildings, [good]: local.buildings[good] + (job.levels ?? 1) },
          industrial: { ...industrial, capital: industrial.capital + projectOpeningCapital(job) },
        };
      } else societies[stateId] = { ...societies[stateId], [good]: societies[stateId][good] + 1 };
    }
    return remaining;
  }
  for (const [id, country] of Object.entries(countryEconomies)) {
    const construction = production.countries[id].construction!;
    country.queue = complete(country.queue, construction.public.points);
    const nation = nations[id];
    nation.privateQueue = complete(nation.privateQueue, construction.private.points);
  }
  return { ...state, stateEconomies, countryEconomies, societies, nations, lastEconomy: production };
}
