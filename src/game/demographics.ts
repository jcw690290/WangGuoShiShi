import type { GameState } from "./engine.ts";
import { marketOf } from "./economy.ts";
import { accepted } from "./society.ts";

export interface PopulationMonth {
  day: number;
  changes: Record<string, number>;
}

const birthRate = 0.036;
const deathRate = 0.030;
const severeFoodShortageMortality = 0.030;

export function settlePopulationMonth<T extends GameState>(state: T, date: Date): T {
  const year = date.getUTCFullYear();
  const previous = new Date(Date.UTC(year, date.getUTCMonth() - 1, 1));
  const previousYear = previous.getUTCFullYear();
  const simulatedMonth = Math.min(date.getTime() - previous.getTime(), state.elapsedDays * 86_400_000);
  const yearLength = Date.UTC(previousYear + 1, 0, 1) - Date.UTC(previousYear, 0, 1);
  const fractionOfYear = simulatedMonth / yearLength;
  const stateEconomies = { ...state.stateEconomies };
  const societies = { ...state.societies };
  const changes: Record<string, number> = {};

  for (const [siteId, owner] of Object.entries(state.ownerByStateId)) {
    const economy = stateEconomies[siteId];
    const site = societies[siteId];
    const population = economy.population;
    const food = state.lastEconomy?.states[siteId].foodFulfillment ?? 1;
    const additionalMortality = severeFoodShortageMortality * Math.max(0, 1 - food / 0.8);
    const populationAfter = population + Math.round(
      population * (birthRate - deathRate - additionalMortality) * fractionOfYear,
    );
    const change = populationAfter - population;
    changes[siteId] = change;
    stateEconomies[siteId] = { ...economy, population: populationAfter };

    // The demo uses the public education unlock and university staffing capacity.
    const education = state.nations[owner].knowledge["公共教育"] === 100 ? 1 : 0;
    const coverage = Math.min(1, site.university * 100_000 / population);
    let peopleSoFar = 0;
    let apportioned = 0;
    const pops = site.pops.map((pop) => {
      peopleSoFar += pop.people;
      const assigned = Math.round(change * (peopleSoFar / population));
      const people = pop.people + assigned - apportioned;
      apportioned = assigned;
      const literacyGain = Math.min(0.002, (0.0001 + 0.0006 * education * coverage) * (1 - pop.literacy / 100));
      return { ...pop, people, literacy: pop.literacy + 100 * literacyGain };
    });
    societies[siteId] = { ...site, pops };
  }

  const destinations = new Map<string, string>();
  for (const [site, owner] of Object.entries(state.ownerByStateId)) {
    const nation = state.nations[owner];
    if (!nation.laws.includes("平等公民权") || !nation.laws.includes("信仰自由")) continue;
    const market = marketOf(state, owner);
    const current = destinations.get(market);
    if (current === undefined || societies[site].university > societies[current].university)
      destinations.set(market, site);
  }
  for (const [site, owner] of Object.entries(state.ownerByStateId)) {
    const target = destinations.get(marketOf(state, owner));
    if (target === undefined || state.ownerByStateId[target] === owner) continue;
    const nation = state.nations[owner];
    for (const pop of societies[site].pops) {
      if (pop.occupation !== "工程师" || accepted(pop, owner, nation) || pop.people === 0) continue;
      const people = Math.min(Math.ceil(pop.people * 0.02), stateEconomies[site].population - 1);
      if (people === 0) break;
      const cohort = societies[target].pops.find((candidate) =>
        candidate.occupation === pop.occupation && candidate.culture === pop.culture && candidate.religion === pop.religion,
      );
      if (cohort) {
        for (const key of ["wealth", "literacy", "radicals"] as const)
          cohort[key] = (cohort[key] * cohort.people + pop[key] * people) / (cohort.people + people);
        cohort.people += people;
      } else societies[target].pops.push({ ...pop, people });
      pop.people -= people;
      stateEconomies[site].population -= people;
      stateEconomies[target].population += people;
      changes[site] -= people;
      changes[target] += people;
    }
  }
  return { ...state, stateEconomies, societies, lastPopulation: { day: state.elapsedDays, changes } };
}
