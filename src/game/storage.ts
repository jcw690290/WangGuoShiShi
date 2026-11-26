import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { z } from "zod";
import { disputeSchema, participants } from "./diplomacy.ts";
import { createGame, DAY_MS, elapsedTicks, getGameDate, isPopulationMonth, TICKS_PER_DAY } from "./engine.ts";
import type { GameState } from "./engine.ts";
import { byIndustrialGood, commercialLevels, goods, industries, isGood, isIndustrialGood, isLocalGood } from "./industry.ts";
import { initialIndustrialAccount, industrialAccountSchema, industrialReportSchema,
  industrialRetrofits, industrySubsidyLimit, industrySubsidyReportSchema, isIndustrialRetrofit } from "./industrial.ts";
import { officeReportSchema } from "./administration.ts";
import { byInstitution, institutionLawDetails, institutionLawKinds, institutionLawOptions,
  institutionReportSchema, welfareReliefSchema } from "./institutions.ts";
import { basicPurchasesSchema, extrasReportSchema, openingBasicBudget, substituteOrdersSchema } from "./households.ts";
import { reservedCropland, subsistenceReportSchema } from "./subsistence.ts";
import { migrateCommercialProduction } from "./commercialMigration.ts";
import { openingMetrics } from "./campaignMetrics.ts";
import { laborLawCategory, startingLaborLaws } from "./labor.ts";
import { isTaxLaw, taxLaws, taxReceiptSchema } from "./taxation.ts";
import { isTradeLaw, tradeLaws } from "./trade-policy.ts";
import { startingStateForm } from "./constitution.ts";
import { industryOwnershipSchema, ownershipAmountsSchema, ownershipKinds, ownershipSchema } from "./ownership.ts";
import { aidOfferSchema, foreignObligationSchema, foreignPairKey, foreignRelationSchema, foreignTreatySchema, treatyOfferSchema } from "./foreign-relations.ts";
import { barracksCapacity, battalionSize, battalionTrainingDays, equipmentDetails } from "./military.ts";
import { injuredPersonnel, replacementTrainingDays } from "./military-health.ts";
import { settlementAt, territorialClaim, territorialClaimSchema, territorialSettlementSchema } from "./territory.ts";
import { seaVoyageCargoCost } from "./transport.ts";
import { buildingCapacity, militaryProcurementCost, projects, unusedPrepaidConstruction } from "./economy.ts";
import { constructionMaintenanceSchema, constructionReportSchema, constructionStockSchema, constructionSpending, constructionWage } from "./construction.ts";
import { nationSchema, siteSocialSchema, projectTypes } from "./society.ts";
import { importRegionalSave } from "./legacySave.ts";
import { borderScenario } from "../scenario/scenario.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { initialSettings, settingsSchema, validDifficultyHistory } from "./settings.ts";
import { campaignSchema, endingId, endingSchema } from "./campaign.ts";
import type { EndingRecord } from "./campaign.ts";
import { fiscalAccountSchema } from "./fiscal.ts";
import { syncOccupation } from "./occupation.ts";
import { diplomaticTieSchema } from "./diplomatic-ties.ts";
import { routeTransport, tradeDeliverySchema, tradeRouteKey, tradeRouteSchema } from "./trade.ts";
import { fleetReportSchema, fleetSpending, maximumConvoyCapacity } from "./fleet.ts";
import { navyReportSchema } from "./navy.ts";
import { opiumLossKey, opiumLossSchema, opiumReportSchema, opiumSmugglingSchema } from "./opium.ts";
import { compromiseDays, constitutionalCrisisSchema } from "./constitutional-crises.ts";
import { civilWarResultSchema, civilWarSchema, oppositionId, scenarioWithCivilWar } from "./civil-war.ts";
import { achievementKey, achievementRecordSchema } from "./achievements.ts";
import type { AchievementRecord } from "./achievements.ts";
const storeName = "saves";
const indexName = "saveIndex";
const archiveName = "endings";
const achievementArchiveName = "achievements";
export const saveVersion = 12;
export const manualSaveSlots = ["local", "manual-2", "manual-3", "manual-4", "manual-5"] as const;
export const autoSaveSlots = ["auto-1", "auto-2", "auto-3"] as const;
export const saveSlotSchema = z.enum([...manualSaveSlots, ...autoSaveSlots]);
export type SaveSlot = z.infer<typeof saveSlotSchema>;
const summarySchema = z.object({
  slot: saveSlotSchema,
  savedAt: z.int().nonnegative(),
  countryId: z.string().nullable(),
  date: z.iso.date().nullable(),
});
export type SaveSummary = z.infer<typeof summarySchema>;

interface SaveDatabase extends DBSchema {
  saves: { key: SaveSlot; value: unknown };
  saveIndex: { key: SaveSlot; value: unknown };
  endings: { key: string; value: unknown };
  achievements: { key: string; value: unknown };
}

function openSaves() {
  return openDB<SaveDatabase>("wang-guo-shi-shi", 4, {
    upgrade(db, previous) {
      if (previous === 0) db.createObjectStore(storeName);
      if (previous < 2) db.createObjectStore(indexName);
      if (previous < 3) db.createObjectStore(archiveName);
      if (previous < 4) db.createObjectStore(achievementArchiveName);
    },
  });
}

async function readSaveIndex(db: IDBPDatabase<SaveDatabase>): Promise<SaveSummary[]> {
  const tx = db.transaction([storeName, indexName]);
  const [rows, legacy] = await Promise.all([
    tx.objectStore(indexName).getAll(),
    tx.objectStore(storeName).getKey("local"),
  ]);
  const entries = rows.map((row) => summarySchema.parse(row));
  if (legacy !== undefined && !entries.some(({ slot }) => slot === "local"))
    entries.push({ slot: "local", savedAt: 0, countryId: null, date: null });
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export async function listGameSaves(): Promise<SaveSummary[]> {
  const db = await openSaves();
  try {
    return await readSaveIndex(db);
  } finally {
    db.close();
  }
}

export function autoSaveSlot(date: Date) {
  return autoSaveSlots[date.getUTCMonth() % autoSaveSlots.length];
}

export async function saveGame(scenario: Scenario, state: GameState, slot: SaveSlot, replace: boolean) {
  if (state.playerCountryId === null) throw new Error("请先选择国家");
  const summary: SaveSummary = {
    slot, savedAt: Date.now(), countryId: state.playerCountryId,
    date: getGameDate(scenario, state).toISOString().slice(0, 10),
  };
  const db = await openSaves();
  try {
    const tx = db.transaction([storeName, indexName], "readwrite");
    if (!replace && await tx.objectStore(storeName).getKey(slot) !== undefined) {
      await tx.done;
      throw new Error("该存档槽已有存档。请刷新列表并确认覆盖。");
    }
    await Promise.all([
      tx.objectStore(storeName).put({ version: saveVersion, scenarioId: scenario.id, state }, slot),
      tx.objectStore(indexName).put(summary, slot),
      tx.done,
    ]);
    return summary;
  } finally {
    db.close();
  }
}

export async function loadGame(scenario: Scenario, slot: SaveSlot): Promise<GameState | undefined> {
  const db = await openSaves();
  try {
    const save = await db.get(storeName, slot);
    if (save === undefined) return;
    return parseSave(scenario, save);
  } finally {
    db.close();
  }
}

export async function loadRecentGame(scenario: Scenario) {
  const db = await openSaves();
  try {
    let lastError: unknown;
    let skipped = 0;
    for (const { slot } of await readSaveIndex(db)) {
      const saved = await db.get(storeName, slot);
      if (saved === undefined) continue;
      try {
        return { state: parseSave(scenario, saved), slot, skipped };
      } catch (error) {
        lastError = error;
        skipped++;
      }
    }
    if (skipped > 0) throw new Error("没有可读取的存档", { cause: lastError });
  } finally {
    db.close();
  }
}

export async function archiveEnding(ending: EndingRecord) {
  const db = await openSaves();
  try {
    await db.put(archiveName, ending, ending.campaignId);
  } finally {
    db.close();
  }
}

export async function listEndings() {
  const db = await openSaves();
  try {
    return (await db.getAll(archiveName)).map((entry) => endingSchema.parse(entry))
      .sort((a, b) => b.date.localeCompare(a.date));
  } finally {
    db.close();
  }
}

export async function archiveAchievements(records: readonly AchievementRecord[]) {
  const db = await openSaves();
  try {
    const tx = db.transaction(achievementArchiveName, "readwrite");
    for (const record of records) {
      const key = achievementKey(record);
      const previous = await tx.store.get(key);
      if (previous === undefined || achievementRecordSchema.parse(previous).date > record.date)
        await tx.store.put(record, key);
    }
    await tx.done;
  } finally {
    db.close();
  }
}

export async function listAchievements() {
  const db = await openSaves();
  try {
    return (await db.getAll(achievementArchiveName)).map((entry) => achievementRecordSchema.parse(entry))
      .sort((a, b) => b.date.localeCompare(a.date));
  } finally {
    db.close();
  }
}

const uint = z.int().nonnegative(),
  cash = z.int(),
  fraction = z.number().min(0).max(1);
const goodsNumbers = z.object({ grain: uint, cloth: uint, ...byIndustrialGood(() => uint.default(0)) });
const allowedQuote = (base: number) => z.number().min(base * 0.25).max(base * 1.75);
const quotes = z.object({
  grain: allowedQuote(industries.grain.basePrice),
  cloth: allowedQuote(industries.cloth.basePrice),
  ...byIndustrialGood((good) => allowedQuote(industries[good].basePrice).default(industries[good].basePrice)),
});
const market = z.object({
  demand: uint, supply: uint, price: z.int().positive(), traded: uint.optional(), targetPrice: z.int().positive().optional(),
})
  .refine((good) => good.traded === undefined || good.traded <= Math.min(good.supply, good.demand));
const industry = z.object({ employed: uint, output: uint, wages: uint, sold: uint.optional(), bought: uint.optional(),
  electric: z.literal(true).optional() })
  .refine((good) => good.sold === undefined || good.sold <= good.output);
const issue = z.object({ demand: uint, delivered: uint }).refine((i) => i.delivered <= i.demand);
const military = z.object({
  regulars: uint,
  trainedRegulars: uint.optional(),
  conscripts: uint,
  trainedConscripts: uint.optional(),
  deployedConscripts: uint.optional(),
  injuredTroops: uint.optional(),
  grainDemand: uint,
  grainDrawn: uint,
  grainTransport: uint,
  seaCargoUsed: uint.optional(),
  procurement: z.object({ grain: uint, cloth: uint, arms: uint.optional(), ammo: uint.optional(),
    oil: uint.optional(), rubber: uint.optional() }).optional(),
  equipment: z.object({ weapons: issue, ammunition: issue, uniforms: issue, fuel: issue.optional(), spares: issue.optional() }),
  readiness: fraction,
  supplyRatio: fraction.optional(),
}).refine((force) =>
  (force.trainedRegulars ?? 0) <= force.regulars &&
  (force.trainedConscripts ?? 0) <= force.conscripts &&
  (force.deployedConscripts ?? 0) <= (force.trainedConscripts ?? 0));
const countryReport = z.object({
  market: z.object({ grain: market, cloth: market, ...byIndustrialGood((good) =>
    market.default({ supply: 0, demand: 0, price: industries[good].basePrice })) }),
  tax: uint,
  wageTaxRate: z.literal([10, 14]),
  wageTaxGain: uint,
  taxReceipts: taxReceiptSchema.optional(),
  clothOutputBonus: z.literal([0, 25, 40]),
  clothOutputGain: uint,
  military,
  investment: uint,
  capacity: z.number().nonnegative(),
  construction: constructionReportSchema.optional(),
  constructionMaintenance: constructionMaintenanceSchema.optional(),
  tribute: uint,
  upkeep: uint,
  publicIndustryIncome: uint.optional(),
  industrySubsidiesPaid: uint.optional(),
  interestPaid: uint.optional(),
  universityWages: uint.optional(),
  administrationWages: uint.optional(),
  officeUpkeep: uint.optional(),
  healthcareUpkeep: uint.optional(),
  policingUpkeep: uint.optional(),
  welfareUpkeep: uint.optional(),
  educationUpkeep: uint.optional(),
  tradeTariff: uint.optional(),
  tradeSeaCargo: uint.optional(),
  fleet: fleetReportSchema.optional(),
  navy: navyReportSchema.optional(),
}).refine((country) => country.taxReceipts === undefined ||
  country.taxReceipts.income + country.taxReceipts.excise + (country.tradeTariff ?? 0) === country.tax
).refine((country) => (country.officeUpkeep ?? 0) + (country.healthcareUpkeep ?? 0) + (country.policingUpkeep ?? 0) +
  (country.welfareUpkeep ?? 0) + (country.educationUpkeep ?? 0) + militaryProcurementCost(country.military.procurement) +
  (country.construction === undefined ? 0 : constructionSpending(country.construction.public)) +
  (country.constructionMaintenance === undefined ? 0 : constructionSpending(country.constructionMaintenance)) +
  (country.fleet === undefined ? 0 : fleetSpending(country.fleet)) + (country.navy?.spending ?? 0) <= country.upkeep);
const siteReport = z.object({
  industries: z.object({ grain: industry, cloth: industry, ...byIndustrialGood(() =>
    industry.default({ employed: 0, output: 0, wages: 0 })) }),
  populationChange: cash.optional(),
  foodFulfillment: fraction.optional(),
  householdConsumption: goodsNumbers.optional(),
  householdBasicPurchases: basicPurchasesSchema.optional(),
  householdBasicOrders: goodsNumbers.optional(),
  opium: opiumReportSchema.optional(),
  householdSubstituteOrders: substituteOrdersSchema.optional(),
  subsistence: subsistenceReportSchema.optional(),
  householdExtras: extrasReportSchema.optional(),
  constructionGoods: goodsNumbers.optional(),
  construction: constructionReportSchema.optional(),
  constructionMaintenance: constructionMaintenanceSchema.optional(),
  industrial: industrialReportSchema.optional(),
  industrySubsidy: industrySubsidyReportSchema.optional(),
  office: officeReportSchema.optional(),
  localFiscal: z.object({ balance: uint, retainedTax: uint, publicSpending: uint }).optional(),
  healthcare: institutionReportSchema.healthcare.optional(),
  policing: institutionReportSchema.policing.optional(),
  welfare: institutionReportSchema.welfare.optional(),
  education: institutionReportSchema.education.optional(),
  welfareRelief: welfareReliefSchema.optional(),
  consumptionIndex: z.number().nonnegative().optional(),
  conscripts: uint,
  deployedConscripts: uint.optional(),
  regulars: uint,
  universityStaff: z.number().nonnegative().optional(),
  workforce: uint.optional(),
  administrationStaff: z.number().nonnegative().optional(),
  freightWages: uint.optional(),
  portTradeCargo: uint.optional(),
  portMilitaryCargo: uint.optional(),
  power: z.object({ requested: uint, delivered: uint, spending: uint }).optional(),
  builders: uint,
  access: fraction,
  localPrices: goodsNumbers,
  dividends: uint,
  ownershipIncome: ownershipAmountsSchema.optional(),
  investment: uint,
}).refine((site) => (site.deployedConscripts ?? 0) <= site.conscripts
).refine((site) => site.power === undefined ||
  site.power.delivered <= Math.min(site.industries.electricity.output, site.power.requested)
).refine((site) => site.construction === undefined ||
  site.construction.public.wages + site.construction.private.wages === site.builders * constructionWage
).refine((site) => site.householdConsumption === undefined
  ? site.consumptionIndex === undefined
  : site.consumptionIndex !== undefined && site.foodFulfillment !== undefined);
export function parseSave(baseScenario: Scenario, save: unknown): GameState {
  const header = z.object({ version: z.int(), scenarioId: z.string(), weeklyConstruction: z.literal(true).optional() }).safeParse(save);
  if (!header.success) throw new Error("存档数据无效");
  if (header.data.version >= 1 && header.data.version <= 4) {
    const source =
      header.data.scenarioId === borderScenario.id && baseScenario.id === "world-1820"
        ? borderScenario
        : baseScenario;
    return syncOccupation(baseScenario, importRegionalSave(source, baseScenario, save));
  }
  const civilHeader = z.object({ state: z.object({ civilWar: civilWarSchema.optional() }) }).safeParse(save);
  if (!civilHeader.success) throw new Error("存档内战记录无效", { cause: civilHeader.error });
  const { civilWar } = civilHeader.data.state;
  if (civilWar && !Object.hasOwn(baseScenario.countries, civilWar.countryId)) throw new Error("存档内战所属国家无效");
  const scenario = scenarioWithCivilWar(baseScenario, civilWar);
  const sites = z.enum(Object.keys(scenario.states)),
    countries = z.enum(Object.keys(scenario.countries));
  const registeredCountries = z.enum(Object.keys(baseScenario.countries));
  // A valid map ID is optional until claimed; enum-keyed records require every ID.
  const activeSite = z.string().refine((id) => Object.hasOwn(scenario.states, id));
  const activeCountry = z.string().refine((id) => Object.hasOwn(scenario.countries, id));
  const project = z.object({ stateId: sites, good: z.enum(projectTypes), weeksLeft: z.number().positive(),
    levels: uint.positive().optional(), ownership: ownershipSchema.optional() });
  const lastPopulation = z.object({ day: uint.positive(), changes: z.record(activeSite, cash) }).nullable();
  const stateEconomy = z.object({ population: z.int().positive(), buildings: goodsNumbers, localQuotes: quotes.optional(),
    industrial: industrialAccountSchema.optional(), basicBudget: uint, discretionaryBudget: uint.optional(), cropland: uint.optional(),
    constructionStock: constructionStockSchema.optional(), localTreasury: uint.optional(),
    ownership: industryOwnershipSchema.optional(),
    commercialRecipes: z.literal(true).optional(),
    inheritedArmamentCapacity: z.object({ arms: uint.optional(), ammo: uint.optional() }).optional() });
  const legacyBudgets = z.record(activeSite, stateEconomy.extend({ basicBudget: uint.optional() })
    .transform((local) => ({ ...local, basicBudget: local.basicBudget ?? openingBasicBudget(local.population) })));
  const stateSchema = z.object({
    elapsedDays: uint.max(Math.floor((8.64e15 - Date.parse(scenario.startDate)) / DAY_MS)),
    playerCountryId: registeredCountries,
    rng: uint.max(0xffffffff),
    ownerByStateId: z.record(activeSite, countries),
    stateEconomies: z.record(activeSite, stateEconomy),
    countryEconomies: z.record(countries, z.object({
      treasury: cash, queue: z.array(project), referenceQuotes: quotes.optional(), fiscal: fiscalAccountSchema.optional(),
      industrySubsidies: z.record(activeSite, industrySubsidyLimit.positive()).optional(),
    })),
    societies: z.record(activeSite, siteSocialSchema),
    nations: z.record(countries, nationSchema),
    borderDispute: disputeSchema.nullable(),
    diplomaticTies: z.array(diplomaticTieSchema.extend({ senior: countries, partner: countries })).optional(),
    foreignRelations: z.array(foreignRelationSchema).optional(),
    foreignTreaties: z.array(foreignTreatySchema).optional(),
    treatyOffers: z.array(treatyOfferSchema).optional(),
    aidOffers: z.array(aidOfferSchema).optional(),
    foreignObligations: z.array(foreignObligationSchema).optional(),
    territorialClaims: z.array(territorialClaimSchema).optional(),
    territorialSettlements: z.array(territorialSettlementSchema).optional(),
    opiumLosses: z.array(opiumLossSchema).optional(),
    constitutionalCrises: z.record(activeCountry, constitutionalCrisisSchema).optional(),
    civilWar: civilWarSchema.optional(),
    lastCivilWar: civilWarResultSchema.extend({ countryId: registeredCountries }).optional(),
    tradeRoutes: z.array(tradeRouteSchema.extend({ from: sites, to: sites, exporter: countries, importer: countries })).optional(),
    occupation: z.object({ stateId: sites, controllerId: countries }).optional(),
    lastEconomy: z
      .object({
        states: z.record(activeSite, siteReport),
        countries: z.record(countries, countryReport),
        trade: z.array(tradeDeliverySchema).optional(),
        opiumSmuggling: z.array(opiumSmugglingSchema).optional(),
      })
      .nullable(),
    lastPopulation: lastPopulation.optional(),
  });
  const scenarioId = z.literal(scenario.id);
  const timedStateSchema = stateSchema.extend({ tickInDay: uint.max(TICKS_PER_DAY - 1) });
  const settingsStateSchema = timedStateSchema.extend({ settings: settingsSchema });
  const campaignStateSchema = settingsStateSchema.extend({ lastPopulation, campaign: campaignSchema.optional() });
  const legacyProject = project.extend({ good: z.enum([...projectTypes, "arsenal", "ammunition"])
    .transform((good) => good === "arsenal" ? "arms" as const : good === "ammunition" ? "ammo" as const : good) });
  const legacyFields = {
    stateEconomies: legacyBudgets,
    societies: z.record(activeSite, siteSocialSchema.extend({ arsenal: uint.optional(), ammunition: uint.optional() })),
    countryEconomies: z.record(countries, stateSchema.shape.countryEconomies.valueType.extend({ queue: z.array(legacyProject) })),
  };
  const schema = z
    .discriminatedUnion("version", [
      z.object({ version: z.literal(5), scenarioId, state: stateSchema.extend(legacyFields) }),
      z.object({ version: z.literal(6), scenarioId, state: timedStateSchema.extend(legacyFields) }),
      z.object({ version: z.literal(7), scenarioId, state: settingsStateSchema.extend(legacyFields) }),
      z.object({ version: z.literal(8), scenarioId, state: campaignStateSchema.extend(legacyFields) }),
      z.object({ version: z.literal(9), scenarioId, state: campaignStateSchema.extend(legacyFields) }),
      z.object({ version: z.literal(10), scenarioId, state: campaignStateSchema.extend({ stateEconomies: legacyBudgets }) }),
      z.object({ version: z.literal(11), scenarioId, state: campaignStateSchema }),
      z.object({
        version: z.literal(saveVersion),
        scenarioId,
        state: campaignStateSchema,
      }),
    ])
    .safeParse(save);
  if (!schema.success) throw new Error("存档数据无效或版本不兼容", { cause: schema.error });
  const data = schema.data;
  const state: GameState = data.version === 5 || data.version === 6 || data.version === 7 ? {
    ...data.state,
    tickInDay: data.version === 5 ? 0 : data.state.tickInDay,
    settings: data.version === 7 ? data.state.settings : initialSettings("standard"),
    lastPopulation: data.state.lastPopulation ?? null,
  } : data.state;
  if (!validDifficultyHistory(state.settings, elapsedTicks(state))) throw new Error("存档难度记录无效");
  function invalid(): never {
    throw new Error("存档中的人口、工程、外交或归属数据无效");
  }
  const owned = Object.keys(state.ownerByStateId);
  const campaign = state.campaign;
  if (campaign) {
    const ending = campaign.ending;
    const beginning = Date.parse(scenario.startDate);
    const currentTime = getGameDate(scenario, state).getTime();
    if (
      Date.UTC(campaign.endYear, 0, 1) <= beginning ||
      (ending !== null && (ending.campaignId !== campaign.id || ending.countryId !== state.playerCountryId ||
        Date.parse(ending.date) > currentTime || (ending.endingId !== undefined && ending.endingId !== endingId(ending.countryId, ending.kind))))
    ) invalid();
    const outcome = campaign.outcome;
    if (outcome && [outcome.lossSince, outcome.victorySince, outcome.genericSince, outcome.aggressionFreeSince]
      .some((day) => day !== null && day > state.elapsedDays)) throw new Error("存档终局计时无效");
    const progress = campaign.achievements;
    const latestAward = ending === null ? currentTime : Date.parse(ending.date);
    if (progress && ((progress.peaceSince !== null && progress.peaceSince > state.elapsedDays) ||
      progress.records.some((record) => record.campaignId !== campaign.id ||
        record.countryId !== state.playerCountryId ||
        Date.parse(record.date) < beginning || Date.parse(record.date) > latestAward)))
      throw new Error("存档成就记录无效");
  }
  const population = state.lastPopulation;
  if (population && (
    population.day > state.elapsedDays ||
    !isPopulationMonth(scenario, { ...state, elapsedDays: population.day, tickInDay: 0 }) ||
    Object.keys(population.changes).some((id) => !Object.hasOwn(state.ownerByStateId, id))
  )) invalid();
  const sameSites = (record: object) =>
    Object.keys(record).length === owned.length && owned.every((id) => Object.hasOwn(record, id));
  if (
    !sameSites(state.stateEconomies) ||
    !sameSites(state.societies) ||
    (state.lastEconomy !== null && !sameSites(state.lastEconomy.states)) ||
    Object.values(scenario.states).some((s) => s.ownerId !== null && !Object.hasOwn(state.ownerByStateId, s.id))
  ) invalid();
  if (data.version >= 9 && owned.some((id) => state.stateEconomies[id].commercialRecipes !== true)) invalid();
  for (const id of owned) {
    const { ownership, buildings } = state.stateEconomies[id];
    if (ownership && goods.some((good) => {
      const levels = ownership[good];
      return levels && ownershipKinds.reduce((total, kind) => total + levels[kind], 0) !== buildings[good];
    })) invalid();
  }
  let migratedArmaments = false;
  if (data.version !== saveVersion && data.version !== 11 && data.version !== 10) for (const [id, site] of Object.entries(data.state.societies)) {
    if (site.arsenal === undefined && site.ammunition === undefined) continue;
    const local = state.stateEconomies[id];
    const inherited = { arms: site.arsenal ?? 0, ammo: site.ammunition ?? 0 };
    delete site.arsenal;
    delete site.ammunition;
    const opening = initialIndustrialAccount({ grain: 0, cloth: 0, ...inherited });
    const account = local.industrial;
    if (opening) local.industrial = account ? {
      capital: account.capital + opening.capital,
      stocks: byIndustrialGood((good) => account.stocks[good] + opening.stocks[good]),
    } : opening;
    const queue = state.countryEconomies[state.ownerByStateId[id]].queue;
    for (const good of ["arms", "ammo"] as const) {
      local.buildings[good] += inherited[good];
      const committed = local.buildings[good] + queue.filter((p) => p.good === good && p.stateId === id).length;
      if (committed > buildingCapacity(scenario.states[id], local, good)) {
        local.inheritedArmamentCapacity ??= {};
        local.inheritedArmamentCapacity[good] = committed;
      }
    }
    migratedArmaments = true;
  }
  if (migratedArmaments) state.lastEconomy = null;
  const relationKeys = new Set<string>(), treatyKeys = new Set<string>();
  const liveCountries = new Set(Object.values(state.ownerByStateId));
  for (const row of state.foreignRelations ?? []) {
    const key = foreignPairKey(row.a, row.b);
    if (relationKeys.has(key) || !Object.hasOwn(state.nations, row.a) || !Object.hasOwn(state.nations, row.b) ||
        (row.giftA ?? 0) > state.elapsedDays || (row.giftB ?? 0) > state.elapsedDays) invalid();
    relationKeys.add(key);
  }
  for (const treaty of state.foreignTreaties ?? []) {
    const key = treaty.kind + foreignPairKey(treaty.a, treaty.b);
    if (treatyKeys.has(key) || !liveCountries.has(treaty.a) || !liveCountries.has(treaty.b) || treaty.signedDay > state.elapsedDays) invalid();
    treatyKeys.add(key);
  }
  for (const offer of state.treatyOffers ?? []) {
    const key = offer.kind + foreignPairKey(offer.from, offer.to);
    if (treatyKeys.has(key) || !liveCountries.has(offer.from) || !liveCountries.has(offer.to) || offer.offeredDay > state.elapsedDays) invalid();
    treatyKeys.add(key);
  }
  const aidKeys = new Set<string>();
  for (const obligation of state.foreignObligations ?? []) {
    const { creditor, debtor, incurredDay } = obligation;
    const key = foreignPairKey(creditor, debtor);
    if (aidKeys.has(key) || !liveCountries.has(creditor) || !liveCountries.has(debtor) || incurredDay > state.elapsedDays) invalid();
    aidKeys.add(key);
  }
  for (const offer of state.aidOffers ?? []) {
    const key = foreignPairKey(offer.from, offer.to);
    if (aidKeys.has(key) || !liveCountries.has(offer.from) || !liveCountries.has(offer.to) || offer.offeredDay > state.elapsedDays) invalid();
    aidKeys.add(key);
  }
  const claimKeys = new Set<string>();
  for (const claim of state.territorialClaims ?? []) {
    const key = JSON.stringify([claim.claimantId, claim.stateId]);
    if (claimKeys.has(key) || !Object.hasOwn(scenario.states, claim.stateId) ||
        !liveCountries.has(claim.claimantId) || state.ownerByStateId[claim.stateId] === claim.claimantId ||
        claim.recognizedBy.some((id) => !liveCountries.has(id)) || claim.declaredDay > state.elapsedDays) invalid();
    claimKeys.add(key);
  }
  const settlementKeys = new Set<string>();
  for (const project of state.territorialSettlements ?? []) {
    const site = scenario.states[project.stateId], anchor = scenario.states[project.anchorId];
    if (!site || !anchor || settlementKeys.has(site.id) || Object.hasOwn(state.ownerByStateId, site.id) ||
        !liveCountries.has(project.countryId) || project.startedDay > state.elapsedDays ||
        (site.unownedStatus === "LOCAL_POLITY") !== (project.mode === "INDIRECT") ||
        (project.sea ? !site.coastal || !anchor.coastal || seaVoyageCargoCost(site.label, anchor.label) > 2 :
          !site.neighbors.includes(anchor.id))) invalid();
    settlementKeys.add(site.id);
  }
  const opiumLossKeys = new Set<string>();
  for (const entry of state.opiumLosses ?? []) {
    const key = opiumLossKey(entry);
    if (opiumLossKeys.has(key) || !Object.hasOwn(scenario.states, entry.stateId) ||
        !Object.hasOwn(state.nations, entry.exporter) || !Object.hasOwn(state.nations, entry.importer) ||
        entry.day > state.elapsedDays) invalid();
    opiumLossKeys.add(key);
  }
  for (const crisis of Object.values(state.constitutionalCrises ?? {})) {
    if ("demand" in crisis ? crisis.since > state.elapsedDays : crisis.compromiseUntil > state.elapsedDays + compromiseDays)
      throw new Error("存档政体冲突计时无效");
  }
  if (data.version !== saveVersion && migrateCommercialProduction(state) && campaign?.outcome?.baseline && campaign.ending === null) {
    const fresh = openingMetrics(createGame(scenario, 1820, state.settings.difficulty), state.playerCountryId!);
    campaign.outcome = { ...campaign.outcome, metrics: {}, lossSince: null, victorySince: null, genericSince: null,
      baseline: { ...fresh, army: campaign.outcome.baseline.army } };
  }
  if (state.diplomaticTies) {
    const live = new Set(Object.values(state.ownerByStateId));
    const pairs = new Set<string>();
    for (const { senior, partner } of state.diplomaticTies) {
      const pair = [senior, partner].sort().join("/");
      if (senior === partner || pairs.has(pair) || !live.has(senior) || !live.has(partner)) invalid();
      pairs.add(pair);
    }
  }
  if (state.tradeRoutes) {
    const keys = new Set<string>();
    for (const route of state.tradeRoutes) {
      const key = tradeRouteKey(route);
      const capacity = routeTransport(scenario, route.from, route.to, route.mode);
      if (keys.has(key) || !capacity || isLocalGood(route.good) || route.importer === route.exporter ||
          route.fromCapacity !== capacity.fromCapacity || route.toCapacity !== capacity.toCapacity || route.cargoCost !== capacity.cargoCost ||
          !Object.hasOwn(state.ownerByStateId, route.from) || !Object.hasOwn(state.ownerByStateId, route.to)) invalid();
      keys.add(key);
    }
  }
  if (state.lastEconomy?.trade?.some(({ from, to, mode, good }) => isLocalGood(good) || !routeTransport(scenario, from, to, mode) ||
      !Object.hasOwn(state.ownerByStateId, from) || !Object.hasOwn(state.ownerByStateId, to))) invalid();
  for (const shipment of state.lastEconomy?.opiumSmuggling ?? []) {
    if (!routeTransport(scenario, shipment.from, shipment.to, shipment.mode) ||
        state.ownerByStateId[shipment.from] !== shipment.exporter || state.ownerByStateId[shipment.to] !== shipment.importer) invalid();
  }
  const configuredLevels = Object.fromEntries(Object.keys(state.nations).map((id) => [id, byInstitution(() => 1)]));
  for (const stateId of owned) {
    const levels = configuredLevels[state.ownerByStateId[stateId]];
    for (const kind of institutionLawKinds) levels[kind] = Math.max(levels[kind], state.societies[stateId][kind]);
  }
  for (const [id, n] of Object.entries(state.nations)) {
    const subsidies = state.countryEconomies[id].industrySubsidies;
    if (subsidies && Object.keys(subsidies).some((stateId) => state.ownerByStateId[stateId] !== id ||
      state.stateEconomies[stateId].industrial === undefined)) invalid();
    n.startingStateForm ??= startingStateForm(id);
    if (n.lastThreatDay !== undefined && n.lastThreatDay > state.elapsedDays) invalid();
    if (!n.laws.some(isTaxLaw)) n.laws.push(taxLaws[0]);
    if (!n.laws.some(isTradeLaw)) n.laws.push(tradeLaws[0]);
    if (n.tradePartners.some((partner) => partner === id || !Object.hasOwn(state.nations, partner))) invalid();
    for (const law of startingLaborLaws(id)) {
      if (!n.laws.some((current) => laborLawCategory(current) === laborLawCategory(law))) n.laws.push(law);
    }
    // Saves made before institution laws preserve their configured service levels.
    for (const kind of institutionLawKinds) {
      if (!n.laws.some((law) => institutionLawDetails(law)?.kind === kind))
        n.laws.push(institutionLawOptions[kind][configuredLevels[id][kind] - 1]);
    }
    const fiscal = state.countryEconomies[id].fiscal;
    if (fiscal && fiscal.week.day > state.elapsedDays) invalid();
    if (
      (n.marketLeader &&
        (!state.nations[n.marketLeader] ||
          n.marketLeader === id ||
          state.nations[n.marketLeader].marketLeader)) ||
      (n.overlord && n.overlord !== n.marketLeader) ||
      n.interests.some((s) => !scenario.states[s])
    )
      invalid();
    if (Boolean(n.overlord) !== Boolean(n.subjectType)) invalid();
    const queued = [...state.countryEconomies[id].queue, ...n.privateQueue];
    const retrofits = new Set<string>();
    for (const p of queued) {
      if (state.ownerByStateId[p.stateId] !== id || p.weeksLeft > projects[p.good].weeks ||
        (p.ownership !== undefined && !isGood(p.good)) ||
        ((p.good === "port" || p.good === "shipGoods") && !scenario.states[p.stateId].coastal) ||
        (p.levels !== undefined && (!isGood(p.good) || isIndustrialGood(p.good) || p.levels !== commercialLevels[p.good]))) invalid();
      if (isIndustrialRetrofit(p.good)) {
        const key = JSON.stringify([p.stateId, p.good]);
        const { good, technology } = industrialRetrofits[p.good];
        if (retrofits.has(key) || state.societies[p.stateId][p.good] !== 0 ||
            state.stateEconomies[p.stateId].buildings[good] === 0 || n.knowledge[technology] !== 100) invalid();
        retrofits.add(key);
      }
    }
    if (data.version !== saveVersion && header.data.weeklyConstruction !== true) {
      const account = state.countryEconomies[id];
      account.treasury += account.queue.reduce((sum, project) => sum + unusedPrepaidConstruction(project), 0);
      n.investment += n.privateQueue.reduce((sum, project) => sum + unusedPrepaidConstruction(project), 0);
    }
    for (const order of [n.fleet.order, n.navy.order])
      if (order && (state.ownerByStateId[order.stateId] !== id || !scenario.states[order.stateId]?.coastal)) invalid();
    if ((n.navy.armored > 0 || n.navy.order?.model === "armored") && n.knowledge["装甲舰艇"] !== 100) invalid();
    const motorizationPort = n.fleet.motorizationPort;
    if (n.fleet.motorized > n.convoys || (motorizationPort !== null &&
        (state.ownerByStateId[motorizationPort] !== id || !scenario.states[motorizationPort]?.coastal))) invalid();
    if (state.lastEconomy) {
      const { military: m, tradeSeaCargo, fleet, navy } = state.lastEconomy.countries[id];
      for (const port of [fleet?.port, navy?.port])
        if (port && !scenario.states[port]?.coastal) invalid();
      if (m.grainDrawn > Math.min(m.grainDemand, m.grainTransport)) invalid();
      if ((m.seaCargoUsed ?? 0) + (tradeSeaCargo ?? 0) > maximumConvoyCapacity(n)) invalid();
    }
  }
  for (const [id, local] of Object.entries(state.stateEconomies)) {
    const owner = state.ownerByStateId[id], site = state.societies[id];
    const { pops, governance, stability, barracks, barracksTraining, battalionOrders, militaryHealth } = site;
    if (militaryHealth && (injuredPersonnel(site).people > local.population ||
        militaryHealth.injuries.some((group) => group.sufferedDay > state.elapsedDays) ||
        militaryHealth.replacements.some((group) => group.readyDay > state.elapsedDays + replacementTrainingDays))) invalid();
    const latestTrainingDay = state.elapsedDays + battalionTrainingDays;
    if (battalionOrders?.some((order) => order.slot >= Math.ceil(barracks * barracksCapacity / battalionSize) ||
        order.readyDay > latestTrainingDay)) invalid();
    for (const order of battalionOrders ?? []) {
      for (const gear of [order.equipment, order.pendingEquipment]) {
        if (gear === undefined) continue;
        const tech = equipmentDetails[gear].technology;
        if (tech !== null && state.nations[owner].knowledge[tech] !== 100) invalid();
      }
    }
    if (barracksTraining && (barracksTraining.reduce((sum, group) => sum + group.levels, 0) > barracks ||
        barracksTraining.some((group, index) => group.readyDay > latestTrainingDay ||
          (index > 0 && group.readyDay <= barracksTraining[index - 1].readyDay)))) invalid();
    if (governance?.integration && governance.integration.startedAtTick > elapsedTicks(state)) invalid();
    if (stability && Object.values(stability.lastIncident).some((day) => day > state.elapsedDays)) invalid();
    if (!local.industrial && goods.some((good) => local.buildings[good] > 0)) invalid();
    if (local.industrial && local.industrial.stocks.electricity !== 0) invalid();
    if (local.buildings.shipGoods > 0 && !scenario.states[id].coastal) invalid();
    if (pops.reduce((sum, p) => sum + p.people, 0) !== local.population) invalid();
    for (const p of pops) {
      if (
        (p.occupation === "劳工" &&
          !pops.some((e) => e.occupation === "工程师" && e.culture === p.culture)) ||
        (p.occupation === "农民" && !pops.some((e) => e.occupation === "劳工" && e.culture === p.culture))
      )
        invalid();
    }
    const queue = [...state.countryEconomies[owner].queue, ...state.nations[owner].privateQueue];
    if (state.societies[id].port > 0 && !scenario.states[id].coastal) invalid();
    const openingCropland = scenario.states[id].cropland;
    if (openingCropland !== undefined || local.cropland !== undefined) {
      const reserved = reservedCropland(local.buildings, queue.filter((project) => project.stateId === id));
      if (local.cropland !== undefined && reserved > local.cropland) invalid();
      if (local.cropland === undefined) local.cropland = Math.max(openingCropland!, reserved);
    }
    for (const g of goods)
      if (
        local.buildings[g] + queue.reduce((count, p) => count + (p.stateId === id && p.good === g ? p.levels ?? 1 : 0), 0) >
        buildingCapacity(scenario.states[id], local, g)
      )
        invalid();
  }
  const d = state.borderDispute;
  if (state.lastCivilWar && state.lastCivilWar.endedDay > state.elapsedDays) invalid();
  if (civilWar) {
    const rebel = oppositionId(civilWar.countryId);
    if (!d || d.phase !== "war" || d.claimantId !== rebel || d.defenderId !== civilWar.countryId ||
        d.goals.length !== 1 || d.goals[0] !== "regime" || d.allies.length || d.defenders.length || d.peaceOffer ||
        d.outcome !== null || d.progress <= 0 || d.progress >= 100 ||
        !liveCountries.has(rebel) || !liveCountries.has(civilWar.countryId)) invalid();
  } else if (d?.goals.includes("regime")) invalid();
  if (d) {
    const parties = participants(d);
    if (
      !scenario.states[d.targetStateId] ||
      parties.some((id) => !state.nations[id]) ||
      new Set(parties).size !== parties.length ||
      d.since > state.elapsedDays ||
      (d.lastPeaceOfferDay !== undefined && d.lastPeaceOfferDay > state.elapsedDays) ||
      (d.peaceOffer !== undefined && (
        (d.phase !== "countdown" && d.phase !== "war") ||
        (d.peaceOffer.from !== d.claimantId && d.peaceOffer.from !== d.defenderId) ||
        d.peaceOffer.offeredDay !== d.lastPeaceOfferDay ||
        d.peaceOffer.offeredDay < d.since ||
        d.peaceOffer.goals.some((goal) => !d.goals.includes(goal))
      )) ||
      (d.agreedPeace !== undefined && (
        d.phase !== "resolved" || d.unacceptedGoals !== undefined ||
        d.outcome !== (d.agreedPeace.goals.length > 0 ? "victory" : "statusQuo") ||
        d.agreedPeace.goals.some((goal) => !d.goals.includes(goal))
      )) ||
      (d.unacceptedGoals !== undefined && (
        d.phase !== "resolved" || d.outcome !== "victory" || d.goals.length !== 1 ||
        new Set([...d.goals, ...d.unacceptedGoals]).size !== d.goals.length + d.unacceptedGoals.length
      )) ||
      [...d.advance, ...d.mobilized, ...d.raid].some((id) => !parties.includes(id)) ||
      (d.containment !== undefined && (d.containment.length > 3 ||
        new Set(d.containment).size !== d.containment.length ||
        d.containment.some((id) => !d.defenders.includes(id)))) ||
      (d.retreating !== undefined && ((d.phase !== "war" && d.phase !== "resolved") ||
        new Set(d.retreating).size !== d.retreating.length ||
        d.retreating.some((id) => !parties.includes(id) || d.advance.includes(id)))) ||
      (d.losses !== undefined && ((d.phase !== "war" && d.phase !== "resolved") ||
        Object.keys(d.losses).some((id) => !parties.includes(id)))) ||
      d.promises.some((id) => !d.allies.includes(id))
    )
      invalid();
    const executed = d.agreedPeace?.goals ?? d.goals;
    if (d.opiumClaim) {
      if (d.goals[0] !== "opiumCompensation" ||
          (d.opiumClaim.paid !== undefined) !== (d.phase === "resolved" && d.outcome === "victory" &&
            executed.includes("opiumCompensation"))) invalid();
    } else if (d.goals.includes("opiumCompensation")) invalid();
    if (d.settlementStateId !== undefined) {
      if (!Object.hasOwn(scenario.states, d.settlementStateId) || d.goals[0] !== "haltSettlement") invalid();
      if (d.phase !== "resolved") {
        const project = settlementAt(state, d.settlementStateId);
        if (!project || project.countryId !== d.defenderId || project.anchorId !== d.targetStateId ||
            !territorialClaim(state, d.claimantId, d.settlementStateId)) invalid();
      }
    } else if (d.goals.includes("haltSettlement")) invalid();
    if (d.goals.includes("recognition")) {
      if (d.goals.includes("cession") || d.goals.includes("annex")) invalid();
      const claim = territorialClaim(state, d.claimantId, d.targetStateId);
      if (d.phase !== "resolved" && (!claim || claim.recognizedBy.includes(d.defenderId))) invalid();
    }
    const objectives = [d.targetStateId, ...scenario.states[d.targetStateId].neighbors];
    for (const [id, order] of Object.entries(d.frontOrders ?? {})) {
      if (!parties.includes(id) || (d.phase !== "war" && d.phase !== "resolved") ||
          (order.objective !== null && !objectives.includes(order.objective))) invalid();
    }
    for (const [id, mission] of Object.entries(d.navalMissions ?? {})) {
      if (!parties.includes(id) || d.raid.includes(id) || (d.phase !== "war" && d.phase !== "resolved") ||
          !scenario.states[mission.portId]?.coastal) invalid();
    }
    const transferred = d.outcome === "victory" && (executed.includes("cession") || executed.includes("annex"));
    if (state.ownerByStateId[d.targetStateId] !== (transferred ? d.claimantId : d.defenderId)) invalid();
    for (const [id, order] of Object.entries(d.mobilization ?? {})) {
      if (!d.mobilized.includes(id) || order.orderedDay > state.elapsedDays ||
          (d.phase !== "war" && d.phase !== "resolved") ||
          (d.phase === "war" ? order.orderedDay < d.since : order.orderedDay > d.since) ||
          order.origins.some((siteId) => !Object.hasOwn(state.societies, siteId) ||
            (d.phase === "war" && state.ownerByStateId[siteId] !== id))) invalid();
    }
  }
  const controlled = syncOccupation(scenario, state);
  if (state.occupation && controlled !== state) invalid();
  return controlled;
}
