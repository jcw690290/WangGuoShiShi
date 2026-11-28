import { currentDisputes, occupationAt } from "./conflict-state.ts";
import type { GameState } from "./engine.ts";
import { civicPolicy, civicStanding } from "./civic-policy.ts";
import { advanceGroupLeadership, literacyOf, livingStandardOf, trainTechnicalWorkers } from "./society.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { culturalAffinityOf, cultureShares, updateCulturalAffinity } from "./culture.ts";
import { participants } from "./diplomacy.ts";
import { advanceUnrest, emptyStability } from "./unrest.ts";
import { opiumEffects } from "./opium.ts";
import { settleMigration } from "./migration.ts";
import type { PopulationMove } from "./migration.ts";
import { completedServiceWeeks } from "./population-services.ts";
import { DAY_MS } from "./time.ts";
import { maxInstitutionLevel } from "./institutions.ts";
import { industryMethodAt } from "./industrial.ts";
import { productiveBuildings } from "./industry.ts";
import { workForce } from "./labor.ts";

export interface PopulationMonth {
  day: number;
  changes: Record<string, number>;
  moves?: PopulationMove[];
}

const birthRate = 0.036;
const deathRate = 0.030;
const healthcareMortalityReduction = 0.25;
const severeFoodShortageMortality = 0.030;

export function settlePopulationMonth<T extends GameState>(scenario: Scenario, state: T, date: Date): T {
  const year = date.getUTCFullYear();
  const previous = new Date(Date.UTC(year, date.getUTCMonth() - 1, 1));
  const previousYear = previous.getUTCFullYear();
  const simulatedMonth = Math.min(date.getTime() - previous.getTime(), state.elapsedDays * DAY_MS);
  const serviceWeeks = completedServiceWeeks(state.elapsedDays, state.elapsedDays - simulatedMonth / DAY_MS);
  const coverageDivisor = Math.max(1, serviceWeeks);
  const yearLength = Date.UTC(previousYear + 1, 0, 1) - Date.UTC(previousYear, 0, 1);
  const fractionOfYear = simulatedMonth / yearLength;
  const stateEconomies = { ...state.stateEconomies };
  const societies = { ...state.societies };
  const changes: Record<string, number> = {};
  const educationBySite: Record<string, number> = {};
  const rights = Object.fromEntries(Object.entries(state.nations).map(([id, nation]) => [id, civicPolicy(nation.laws)]));
  const frontline = new Set(currentDisputes(state).flatMap((war) => {
    if (war.phase !== "war") return [];
    const parties = new Set(participants(war));
    return [war.targetStateId, ...scenario.states[war.targetStateId].neighbors]
      .filter((id) => parties.has(state.ownerByStateId[id]));
  }));

  for (const [siteId, owner] of Object.entries(state.ownerByStateId)) {
    const economy = stateEconomies[siteId];
    const site = societies[siteId];
    const population = economy.population;
    const occupied = !!occupationAt(state, siteId);
    const latest = state.lastEconomy?.states[siteId];
    const food = latest?.foodFulfillment ?? 1;
    const additionalMortality = severeFoodShortageMortality * Math.max(0, 1 - food / 0.8);
    const { populationServices, ...current } = site;
    const healthCoverage = (populationServices?.healthcare ?? 0) / coverageDivisor;
    const treatment = 0.002 * (populationServices?.treatment ?? 0) / coverageDivisor;
    const burden = opiumEffects(site.opiumBurden);
    const baselineMortality = deathRate * (1 - healthcareMortalityReduction * healthCoverage) - treatment + burden.mortality;
    const schoolCoverage = (populationServices?.school ?? 0) / coverageDivisor;
    const development = Math.min(1, Math.max(0, livingStandardOf(site.pops) - 10) / 20);
    const fertility = birthRate - 0.008 * schoolCoverage * literacyOf(site.pops) / 100 - 0.004 * development;
    const civilianMortality = occupied ? 0.012 : frontline.has(siteId) ? 0.004 : 0;
    const populationAfter = population + Math.round(
      population * (fertility - baselineMortality - additionalMortality - civilianMortality) * fractionOfYear,
    );
    const change = populationAfter - population;
    changes[siteId] = change;
    stateEconomies[siteId] = { ...economy, population: populationAfter };

    const universityCoverage = (populationServices?.university ?? 0) / coverageDivisor;
    const literacyBonus = 0.0006 * maxInstitutionLevel * schoolCoverage;
    educationBySite[siteId] = Math.max(universityCoverage, schoolCoverage);
    let peopleSoFar = 0;
    let apportioned = 0;
    let pops = site.pops.map((pop) => {
      peopleSoFar += pop.people;
      const assigned = Math.round(change * (peopleSoFar / population));
      const people = pop.people + assigned - apportioned;
      apportioned = assigned;
      const literacyGain = Math.min(0.002, (0.0001 + literacyBonus) * (1 - pop.literacy / 100));
      return { ...pop, people, literacy: pop.literacy + 100 * literacyGain };
    });
    if (economy.industryLabor) {
      const nation = state.nations[owner];
      const prior = Object.values(economy.industryLabor.staffing);
      const ordinary = prior.reduce((jobs, staff) => jobs + staff.ordinary, 0) - (latest?.clergyPayroll?.staff ?? 0);
      const technicians = workForce(pops.reduce((total, pop) => total + (pop.occupation === "工程师" ? pop.people : 0), 0),
        site.laborParticipation);
      let desired = (latest?.universityStaff ?? 0) + (latest?.administrationStaff ?? 0);
      let betterPay = false;
      for (const building of productiveBuildings) {
        if (building === "services" || economy.buildings[building] === 0) continue;
        const method = industryMethodAt(building, site);
        const openings = Math.ceil(economy.buildings[building] * method.jobs * method.skill[0] / 100);
        desired += openings;
        if (openings > 0 && method.skill[1] > economy.industryLabor.wage) betterPay = true;
      }
      const vacancies = Math.max(0, desired - technicians);
      pops = trainTechnicalWorkers({ ...current, pops }, siteId, nation, universityCoverage + schoolCoverage,
        Math.max(0, ordinary), vacancies, betterPay);
    }
    const totals = pops.reduce((facts, pop) => {
      facts.radicals += pop.radicals * pop.people;
      facts.living += pop.livingStandard * pop.people;
      facts.excluded += pop.people * (1 - civicStanding(pop, owner, site, rights[owner]));
      return facts;
    }, { radicals: 0, living: 0, excluded: 0 });
    const policing = (populationServices?.policing ?? 0) / coverageDivisor;
    const stability = advanceUnrest(site.stability ?? emptyStability(), date, state.elapsedDays, {
      radicals: totals.radicals / populationAfter, living: totals.living / populationAfter,
      excluded: totals.excluded / populationAfter, food,
      extraHardship: burden.unrest,
      war: occupied ? 35 : frontline.has(siteId) ? 15 : 0,
    }, policing);
    societies[siteId] = { ...current, pops, stability };
  }

  const moves = settleMigration(scenario, { ...state, stateEconomies, societies }, frontline);
  for (const { from, to, people } of moves) {
    changes[from] -= people;
    changes[to] += people;
  }
  const shares = Object.fromEntries(Object.entries(societies).map(([id, site]) => [id, cultureShares(site.pops)]));
  const tradeContacts = new Map<string, Map<string, number>>();
  for (const { from, to, quantity } of state.lastEconomy?.trade ?? []) {
    if (quantity === 0) continue;
    for (const [local, partner] of [[from, to], [to, from]]) {
      const exchanges = tradeContacts.get(local) ?? new Map<string, number>();
      exchanges.set(partner, (exchanges.get(partner) ?? 0) + quantity);
      tradeContacts.set(local, exchanges);
    }
  }
  for (const [id, site] of Object.entries(societies)) {
    const neighbors = scenario.states[id].neighbors.filter((neighbor) => Object.hasOwn(shares, neighbor));
    const trade = [...(tradeContacts.get(id) ?? [])].map(([partner, quantity]) => ({
      shares: shares[partner],
      strength: 0.15 * Math.min(1, quantity / (0.02 * stateEconomies[id].population)),
    }));
    site.culturalAffinity = updateCulturalAffinity(
      culturalAffinityOf(state.societies[id]),
      shares[id],
      neighbors.map((neighbor) => shares[neighbor]),
      educationBySite[id],
      trade,
    );
  }
  const governingCountries = new Set(Object.values(state.ownerByStateId));
  const nations = Object.fromEntries(Object.entries(state.nations).map(([id, nation]) => [
    id, governingCountries.has(id) ? advanceGroupLeadership(nation, id, state.rng) : nation,
  ]));
  return { ...state, stateEconomies, societies, nations, lastPopulation: { day: state.elapsedDays, changes, moves } };
}
