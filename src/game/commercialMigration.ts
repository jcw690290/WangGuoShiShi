import type { GameState } from "./engine.ts";
import type { Project } from "./economy.ts";
import { byIndustrialGood, commercialLevels, convertCommercialLevels, isGood, isIndustrialGood } from "./industry.ts";
import { initialIndustrialAccount } from "./industrial.ts";
import { croplandPerLegacyFarm, reservedCropland } from "./subsistence.ts";

export function migrateCommercialProduction(state: GameState) {
  const legacy = new Set(Object.keys(state.stateEconomies).filter((id) => state.stateEconomies[id].commercialRecipes === undefined));
  if (legacy.size === 0) return false;
  function convert<T extends Project>(project: T): T {
    const { good } = project;
    return legacy.has(project.stateId) && isGood(good) && !isIndustrialGood(good)
      ? { ...project, levels: commercialLevels[good] } : project;
  }
  for (const [id, country] of Object.entries(state.countryEconomies)) {
    country.queue = country.queue.map(convert);
    state.nations[id].privateQueue = state.nations[id].privateQueue.map(convert);
  }
  for (const id of legacy) {
    const local = state.stateEconomies[id];
    const legacyGrain = local.buildings.grain;
    local.buildings = convertCommercialLevels(local.buildings);
    local.commercialRecipes = true;
    const capital = initialIndustrialAccount({ grain: local.buildings.grain, cloth: local.buildings.cloth });
    if (capital) {
      const existing = local.industrial;
      local.industrial = existing ? {
        capital: existing.capital + capital.capital,
        stocks: byIndustrialGood((good) => existing.stocks[good] + capital.stocks[good]),
      } : capital;
    }
    if (local.cropland !== undefined) {
      const owner = state.ownerByStateId[id];
      const queue = [...state.countryEconomies[owner].queue, ...state.nations[owner].privateQueue];
      local.cropland = Math.max(local.cropland + legacyGrain * croplandPerLegacyFarm,
        reservedCropland(local.buildings, queue.filter((job) => job.stateId === id)));
    }
  }
  state.lastEconomy = null;
  return true;
}
