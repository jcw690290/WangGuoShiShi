import type { Scenario } from "../scenario/scenario.ts";
import type { GameState } from "./engine.ts";
import { elapsedTicks } from "./time.ts";
import type { WarPlan } from "./diplomacy.ts";
import { byGood, byIndustrialGood, commercialLevels, goods, industries, isGood, isIndustrialGood, legacyCommercialCost } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import { accepted, evolvePops, facilityTypes, approval, tributeRate } from "./society.ts";
import type { SiteSocial } from "./society.ts";
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
import { affordableIndustryWorkers, emptyIndustrialAccount, fundedRestock, initialIndustrialAccount,
  industrialPayroll, materialWorkers, operateIndustry, trainedLabourCapacity, workingCapitalPerLevel, workingCapitalTarget } from "./industrial.ts";
import type { IndustrialAccount, IndustrialReport } from "./industrial.ts";
import { deliverOffice, officeNeed, planOffice } from "./administration.ts";
import type { OfficeReport } from "./administration.ts";
import { harvestGood, isCrop, rentRateOf, reservedCropland, subsistenceHarvest } from "./subsistence.ts";
import type { SubsistenceReport } from "./subsistence.ts";
import { affordableCrew, constructionJobs, constructionMaterials, constructionPointsPerLevel, constructionSectors,
  constructionSpending, crewMaterials, deliverConstruction, emptyConstructionReport, materialOrder,
  planConstructionMaintenance, reserveCrew, shareCrew } from "./construction.ts";
import type { ConstructionMaintenance, ConstructionReport, ConstructionSector, ConstructionStock } from "./construction.ts";
import { portCapacity, railCapacityPerLevel } from "./transport.ts";

export { marketOf } from "./market.ts";

export const universityJobs = 100;
export const universityWage = 180;

export type Building = Good | (typeof facilityTypes)[number];
export const projects = {
  ...industries,
  infrastructure: { cost: 210000, weeks: 2 },
  railway: { cost: 300000, weeks: 5 },
  port: { cost: 330000, weeks: 6 },
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
    if (good === "wood" || good === "iron" || good === "coal") return 150;
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
  universityStaff?: number;
  administrationStaff?: number;
  freightWages?: number;
  portTradeCargo?: number;
  portMilitaryCargo?: number;
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
  tradeTariff?: number;
  tradeSeaCargo?: number;
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
export const workForce = (population: number) => Math.floor(population * 0.4);
const fulfillment = (bought: number, demand: number) => demand ? bought / demand : 1;
const siteTaxShare = (site: SiteSocial, occupied: boolean) => occupied ? 0 :
  unrestEffects(site.stability).collection * governanceRules[governanceOf(site).mode].centralTax / 100;
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
  return site.pops.filter((p) => p.occupation === "工程师")
    .reduce((sum, p) => sum + p.people * (accepted(p, owner, nation) ? 1 : 0.65), 0);
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
        const trained = Math.max(0, workForce(availableEngineers(site, owner, state.nations[owner])) - site.university * universityJobs);
        const possible = Math.min(local.buildings[good] * spec.jobs, trainedLabourCapacity(good, trained),
          affordableIndustryWorkers(good, account.capital));
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
        return sum + Math.min(Math.floor(site.conscription * 500 * siteMilitaryShare(site)),
          Math.floor(workForce(state.stateEconomies[id].population) * war!.recruitPercent / 100));
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

export function projectEconomy(state: GameState, war?: WarPlan): EconomyReport {
  return projectSettlement(state, war).report;
}

function projectSettlement(state: GameState, war?: WarPlan, closingTick?: number) {
  const report: EconomyReport = { states: {}, countries: {} };
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
    const labour = workForce(local.population) - regulars;
    const universityStaff = Math.min(labour, workForce(engineers), site.university * universityJobs);
    const unassignedAfterUniversity = Math.min(labour - universityStaff, workForce(engineers) - universityStaff);
    const offices = state.occupation?.stateId === id ? 0 : site.bureaucracy;
    const office = planOffice(officeNeed(local.population, site, nation, state.settings.difficulty),
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
    let workers = labour - universityStaff - administrators - office.staff,
      conscripts = 0;
    const ceilings = orderQuoteCeilings(local, state.countryEconomies[marketOf(state, owner)]);
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
    const account = local.industrial;
    let payrollBudget = account?.capital ?? 0;
    const remaining = account ? { ...account.stocks } : byIndustrialGood(() => 0);
    const restock = byIndustrialGood(() => 0);
    let technicians = workForce(engineers) - universityStaff - administrators - office.staff;
    let skilledWages = 0;
    const access = Math.min(
      1,
      ((site.infrastructure + site.railway * railCapacityPerLevel) * 11000) /
        (local.population + 2000 * (local.buildings.cloth / commercialLevels.cloth + local.buildings.grain / commercialLevels.grain) +
          250 * (local.buildings.wood + local.buildings.iron + local.buildings.coal + local.buildings.tools + local.buildings.paper)),
    ) * effects.transport;
    function produce(g: Good) {
      const spec = industries[g];
      const civilianTarget = g === "arms" || g === "ammo"
        ? Math.ceil(armamentOrders[id][g] * spec.jobs / (spec.output * effects.output)) : Infinity;
      const orderedJobs = civilianTarget === 0 ? 0 : Math.min(civilianTarget + draftQuota - conscripts,
        Math.ceil(civilianTarget * 100 / (100 - draftRate)));
      const jobs = Math.min(
        workers,
        local.buildings[g] * spec.jobs,
        orderedJobs,
        trainedLabourCapacity(g, technicians),
        affordableIndustryWorkers(g, payrollBudget),
      );
      const drafted = Math.min(draftQuota - conscripts, Math.floor(jobs * draftRate / 100));
      conscripts += drafted;
      const civilianJobs = jobs - drafted;
      const employed = operateIndustry(g, civilianJobs, remaining, restock);
      workers -= employed + drafted;
      const payroll = industrialPayroll(g, employed);
      payrollBudget -= payroll.total;
      technicians -= payroll.skilled;
      skilledWages += payroll.skilledWages;
      const base = Math.floor((employed * spec.output * effects.output) / spec.jobs);
      const output = g === "cloth" ? Math.floor((base * (100 + c.clothOutputBonus)) / 100) : base;
      if (g === "cloth") c.clothOutputGain += output - base;
      return { employed, output, wages: payroll.total };
    }
    const suppliesFirst = { grain: produce("grain"), cloth: produce("cloth"), arms: produce("arms"), ammo: produce("ammo") };
    const activity = byGood((g) => Object.hasOwn(suppliesFirst, g) ? suppliesFirst[g as keyof typeof suppliesFirst] : produce(g));
    c.military.regulars += regulars;
    c.military.conscripts += conscripts;
    c.universityWages! += universityStaff * universityWage;
    c.administrationWages! += administrationDue;
    c.upkeep += regulars * 12 + universityStaff * universityWage + administrationDue + office.wages;
    supplies[id] = byGood((g) => activity[g].output);
    const essentialNeeds = byGood((g) => Math.round(local.population * industries[g].demandPerPerson));
    const ruralPeople = site.pops.reduce((sum, pop) => sum + (pop.occupation === "农民" ? pop.people : 0), 0);
    const subsistence = local.cropland === undefined ? undefined : subsistenceHarvest(
      local.cropland, local.buildings, ruralPeople, workers, workForce(ruralPeople),
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
    const extra = extrasOrders(local.population, discretionaryBudget);
    if (account) productionStocks.set(id, { remaining, skilledWages });
    householdOrders[id] = household;
    householdPlans.set(id, { basicBudget, discretionaryBudget, extra });
    constructionOrders[id] = construction;
    demands[id] = byGood((g) => household[g] + (isExtraGood(g) ? extra[g] : 0) + construction[g] +
      (isIndustrialGood(g) ? funded[g] : 0) +
      (g === "paper" ? office.paperDemand : g === "services" ? office.serviceDemand : 0));
    report.states[id] = {
      industries: activity,
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
          if (route.raided && terminals.length > 0) blockadedPorts.add(terminals[0].stateId);
          for (const { stateId, capacity } of terminals) {
            if (remaining === 0) break;
            const handled = Math.min(remaining, capacity);
            militaryPortUse.set(stateId, handled);
            report.states[stateId].portMilitaryCargo = handled;
            if (route.raided) blockadedPorts.add(stateId);
            remaining -= handled;
          }
        }
      }
      if (route.raided && route.maritimeTerminals === undefined)
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
        pool[g].demand += demands[id][g];
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
        supply: supplies[id][g], demand: demands[id][g], access: g === "services" ? 0 : report.states[id].access,
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
      const target = targetPrice(base, supplies[id][g] + (flow?.[g].incoming ?? 0), demands[id][g] + (flow?.[g].outgoing ?? 0));
      return nextPrice(state.stateEconomies[id].localQuotes?.[g] ?? base, target);
    });
    site.localPrices = byGood((g) => {
      const marketShare = g === "services" ? 0 : site.access;
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
    c.market = markets[marketOf(state, owner)];
    const rate =
      (nation.laws.includes("自由放任") ? 0.40 : nation.laws.includes("干预主义") ? 0.25 : 0.10) +
      (approval(nation, "地主") >= 10 || approval(nation, "实业家") >= 10 ? 0.05 : 0);
    let taxableWages = 0,
      taxableDividends = 0,
      capacity = 0;
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
        taxableWages += production.wages * taxShare;
        const demand = demands[id][g];
        const officeOrder = g === "paper" ? office.paperDemand : g === "services" ? office.serviceDemand : 0;
        const residentOrder = household[g] + (isExtraGood(g) ? extra[g] : 0);
        const residentGoods = demand ? Math.floor(production.bought * residentOrder / demand) : 0;
        const basicGoods = Math.min(residentGoods, household[g]);
        const civilianGoods = demand ? Math.floor(production.bought * (residentOrder + construction[g]) / demand) : 0;
        const privateGoods = officeOrder > 0 ? Math.floor(production.bought * (demand - officeOrder) / demand) : production.bought;
        const inputGoods = privateGoods - civilianGoods;
        const payment = localTrade * localPrice + poolBought * m.price + (transfer?.received[g] ?? 0) * s.localPrices[g];
        const paidByPrivate = production.bought > 0 ? Math.floor(payment * privateGoods / production.bought) : 0;
        const paidByHouseholdsAndConstruction = production.bought > 0
          ? Math.floor(payment * civilianGoods / production.bought) : 0;
        const residentCost = production.bought > 0 ? Math.floor(payment * residentGoods / production.bought) : 0;
        const basicCost = production.bought > 0 ? Math.floor(payment * basicGoods / production.bought) : 0;
        const civilianCost = production.bought > 0 ? Math.floor(payment * civilianGoods / production.bought) : 0;
        return {
          residentGoods,
          extraGoods: residentGoods - basicGoods,
          basicCost,
          extraCost: residentCost - basicCost,
          constructionGoods: civilianGoods - residentGoods,
          constructionCost: civilianCost - residentCost,
          inputGoods,
          materialCost: paidByPrivate - paidByHouseholdsAndConstruction,
          officeGoods: production.bought - privateGoods,
          officeCost: payment - paidByPrivate,
        };
      });
      const officeCost = fillsByUse.paper.officeCost + fillsByUse.services.officeCost;
      s.office = deliverOffice(office, fillsByUse.paper.officeGoods, fillsByUse.services.officeGoods, officeCost);
      c.upkeep += officeCost;
      c.officeUpkeep! += s.office.wages + officeCost;
      if (account) {
        const { remaining, skilledWages } = productionStocks.get(id)!;
        const bought = byIndustrialGood((g) => fillsByUse[g].inputGoods);
        const inputCost = goods.reduce((sum, g) => sum + fillsByUse[g].materialCost, 0);
        const available = account.capital + industrialIncome - inputCost;
        if (available < 0) throw new Error("工商业采购超过已落实的周转资金");
        const capital = Math.min(available, workingCapitalTarget(state.stateEconomies[id].buildings));
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
        taxableWages += transfer.freight * taxShare;
        c.tradeTariff! += transfer.tariff;
      }
      const consumption = byGood((g) => fillsByUse[g].residentGoods + (subsistence && harvestGood(g) ? subsistence.retained[g] : 0));
      s.householdConsumption = consumption;
      const delivered = byExtraGood((g) => fillsByUse[g].extraGoods);
      const extraSpending = Object.values(byExtraGood((g) => fillsByUse[g].extraCost)).reduce((sum, paid) => sum + paid, 0);
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
      taxableWages += s.construction.private.wages * taxShare;
      const essentials = basicEquivalentSupply(s.householdConsumption, delivered);
      s.foodFulfillment = fulfillment(essentials.grain, s.householdBasicOrders!.grain);
      const acquiredValue = goods.reduce((sum, g) => sum + consumption[g] * industries[g].basePrice, 0);
      s.consumptionIndex = acquiredValue / (state.stateEconomies[id].population * basketBaseValue);
      c.investment += s.investment;
      taxableDividends += (s.dividends + (subsistence ? subsistence.householdIncome + subsistence.landRent : 0)) * taxShare;
      capacity += s.construction.public.points + s.construction.private.points;
    }
    c.capacity = Math.floor(capacity * 100) / 100;
    const wageTax = Math.floor((taxableWages * c.wageTaxRate) / 100);
    c.tax = wageTax + Math.floor(taxableDividends * 0.05) + c.tradeTariff!;
    c.wageTaxGain = wageTax - Math.floor(taxableWages * 0.1);
    if (nation.subjectType) c.tribute = Math.floor(c.tax * tributeRate[nation.subjectType]);
  }
  return { report, referenceQuotes, localQuotes, industrialClosing, constructionClosing };
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
  if (good === "port" && !scenario.states[stateId].coastal) return "只能在沿海州建设港口";
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

export function settleEconomy(state: GameState, war?: WarPlan, fractionOfYear = 7 / 365): GameState & { lastEconomy: EconomyReport } {
  const closingTick = elapsedTicks(state);
  const tuning = ruleTuning(state.settings);
  const stateEconomies = { ...state.stateEconomies },
    societies = { ...state.societies },
    countryEconomies = { ...state.countryEconomies },
    nations = { ...state.nations };
  // A project completed from this week's deliveries starts operating next week.
  const { report: production, referenceQuotes, localQuotes, industrialClosing, constructionClosing } = projectSettlement(
    state, war, closingTick,
  );
  const budgets = weeklyBudgets(nations, production);
  const campusFunding: Record<string, number> = {};
  const administrationFunding: Record<string, number> = {};
  const militaryPayroll: Record<string, { paid: number; regulars: number; served: number; allocated: number }> = {};
  for (const [id, c] of Object.entries(production.countries)) {
    const country = countryEconomies[id];
    const construction = c.construction!;
    const prepaidUpkeep = c.officeUpkeep! + militaryProcurementCost(c.military.procurement) +
      constructionSpending(construction.public) + constructionSpending(c.constructionMaintenance!);
    const closing = settleFiscal({
      day: state.elapsedDays, treasury: country.treasury, fiscal: country.fiscal,
      tax: c.tax, receipts: budgets[id].balance + c.upkeep, upkeep: c.upkeep,
      prepaidUpkeep,
      fractionOfYear, difficulty: state.settings.difficulty,
    });
    const { week } = closing.fiscal;
    const educationDue = c.universityWages!;
    const administrationDue = c.administrationWages!;
    const civilianDue = educationDue + administrationDue;
    const remainingDue = c.upkeep - prepaidUpkeep;
    const remainingPaid = week.upkeepPaid - prepaidUpkeep;
    const militaryDue = remainingDue - civilianDue;
    const educationPaid = remainingDue > 0 ? Math.floor(remainingPaid * educationDue / remainingDue) : 0;
    const civilianPaid = remainingDue > 0 ? Math.floor(remainingPaid * civilianDue / remainingDue) : 0;
    const administrationPaid = civilianPaid - educationPaid;
    c.universityWages = educationPaid;
    c.administrationWages = administrationPaid;
    campusFunding[id] = educationDue > 0 ? educationPaid / educationDue : 0;
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
    nations[id] = { ...nations[id], morale,
      investment: nations[id].investment - constructionSpending(construction.private) + c.investment };
  }
  for (const [id, s] of Object.entries(production.states)) {
    const owner = state.ownerByStateId[id];
    s.universityStaff! *= campusFunding[owner];
    s.administrationStaff! *= administrationFunding[owner];
    const site = societies[id];
    const privateSpecialistWages = s.industrial?.skilledWages ?? 0;
    const publicSpecialistWages = s.universityStaff! * universityWage + s.administrationStaff! * administrationWage + s.office!.wages;
    const construction = s.construction!;
    const standby = s.constructionMaintenance!;
    const publicConstructionWages = construction.public.wages + standby.wages;
    const labourWages = goods.reduce((sum, good) => sum + s.industries[good].wages, s.freightWages ?? 0)
      - privateSpecialistWages + construction.private.wages;
    const payroll = militaryPayroll[owner];
    payroll.served += s.regulars;
    const assigned = payroll.regulars ? Math.floor(payroll.paid * payroll.served / payroll.regulars) : 0;
    const armyWages = assigned - payroll.allocated;
    payroll.allocated = assigned;
    const jobs = goods.reduce((sum, good) => sum + s.industries[good].employed, s.builders + standby.workers);
    const taxShare = siteTaxShare(site, id === state.occupation?.stateId);
    const netWages = 1 - production.countries[owner].wageTaxRate / 100 * taxShare;
    const ownerIncome = s.dividends * (1 - 0.05 * taxShare) / 2;
    const subsistence = s.subsistence;
    const retainedValue = subsistence ? subsistence.retained.grain * s.localPrices.grain + subsistence.retained.wood * s.localPrices.wood : 0;
    const ruralIncome = (subsistence?.householdIncome ?? 0) * (1 - 0.05 * taxShare);
    const rentIncome = (subsistence?.landRent ?? 0) * (1 - 0.05 * taxShare);
    const basicCost = goods.reduce((sum, good) => sum + industries[good].demandPerPerson * s.localPrices[good], 0) +
      substitutedBasketCost(s.localPrices, s.householdSubstituteOrders!) / stateEconomies[id].population;
    const income = allocateHouseholdIncome(site.pops, basicCost, {
      农民: ruralIncome, 劳工: labourWages * netWages + armyWages + publicConstructionWages,
      工程师: privateSpecialistWages * netWages + publicSpecialistWages,
      资本家: ownerIncome, 贵族: ownerIncome + rentIncome,
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
      laborWages: labourWages + publicConstructionWages, specialistWages: publicSpecialistWages + privateSpecialistWages,
      ruralResources: retainedValue + ruralIncome, landRent: rentIncome,
      dividends: s.dividends,
      businessJobs: jobs,
      standardTarget: livingStandardTarget(s.consumptionIndex!, s.foodFulfillment!),
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
