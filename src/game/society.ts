import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import type { RuleTuning } from "./settings.ts";
import { startingLivingStandard, updateLivingStandard } from "./households.ts";
import { initialCulturalAffinity } from "./culture.ts";
import { governanceLaws, isGovernanceLaw, localGovernanceSchema } from "./governance.ts";
import { emptyStability, stabilitySchema } from "./unrest.ts";
import type { LocalStability } from "./unrest.ts";
import { productiveBuildings } from "./industry.ts";
import { initialFleet, merchantFleetSchema } from "./fleet.ts";
import { institutionDutySchema, institutionLawDetails, institutionLawKinds, institutionLawOptions, institutionLevelSchema } from "./institutions.ts";
import { bondedRuralShare, laborLawCategory, laborLaws, laborProtection, neutralLaborLaws,
  participationTarget, startingLaborLaws, workForce } from "./labor.ts";
import { exciseGoods, exciseGoodsSchema, isTaxLaw, taxBands, taxBandSchema, taxLaws } from "./taxation.ts";
import { isTradeLaw, tariffBandSchema, tradeLaws, tradePartnersSchema } from "./trade-policy.ts";
import { civicLawCategory, civicLaws, civicPolicy, civicStanding, isBaselineCivicLaw } from "./civic-policy.ts";
import { constitutionalFormSchema, constitutionalLaws, constitutionalMandate, constitutionLawCategory,
  powerDistribution, startingStateForm } from "./constitution.ts";
import { economicLaws, isEconomicLaw, ownershipSchema } from "./ownership.ts";
import { barracksTrainingSchema, battalionOrdersSchema } from "./military.ts";
import { militaryHealthSchema } from "./military-health.ts";
import { initialNavy, navySchema } from "./navy.ts";
import { isOpiumLaw, opiumBurdenSchema, opiumLaws } from "./opium.ts";
import { isMilitaryServiceLaw, militaryServiceLaws } from "./military-service.ts";
import { productionProjects, productionTiers } from "./production-methods.ts";
import { officersInService, publicPayBandSchema } from "./public-pay.ts";
import { populationServicesSchema } from "./population-services.ts";

const startingOccupations = ["农民", "劳工", "工程师", "军官", "教士", "店主", "资本家", "贵族"] as const;
export const occupations = [...startingOccupations, "文职", "军人"] as const;
export type Occupation = (typeof occupations)[number];
export const groups = ["乡民", "工会", "知识分子", "武装部队", "教会", "小市民", "实业家", "地主"] as const;
export type Group = (typeof groups)[number];
const leadershipSchema = z.record(z.enum(groups), z.object({
  ability: z.int().min(50).max(80), experience: z.int().min(0).max(24),
}));
type GroupLeadership = z.infer<typeof leadershipSchema>;
const occupationSupport: Record<Occupation, readonly (readonly [Group, number])[]> = {
  农民: [["乡民", 0.70], ["地主", 0.20], ["教会", 0.10]],
  劳工: [["工会", 0.55], ["小市民", 0.15], ["教会", 0.15], ["武装部队", 0.05], ["实业家", 0.05], ["乡民", 0.05]],
  工程师: [["知识分子", 0.40], ["工会", 0.30], ["实业家", 0.20], ["小市民", 0.10]],
  文职: [["小市民", 0.50], ["知识分子", 0.35], ["教会", 0.15]],
  军官: [["武装部队", 0.80], ["小市民", 0.10], ["地主", 0.10]],
  军人: [["武装部队", 0.80], ["小市民", 0.10], ["地主", 0.10]],
  教士: [["教会", 0.80], ["地主", 0.10], ["知识分子", 0.10]],
  店主: [["小市民", 0.65], ["实业家", 0.20], ["教会", 0.15]],
  资本家: [["实业家", 0.85], ["知识分子", 0.10], ["地主", 0.05]],
  贵族: [["地主", 0.85], ["教会", 0.10], ["武装部队", 0.05]],
};
const votingWeights = {
  autocracy: { 上层: 6, 中层: 2, 下层: 0.2 },
  limited: { 上层: 4, 中层: 2, 下层: 0.6 },
  universal: { 上层: 1.5, 中层: 1.2, 下层: 1 },
};
export const distributionName = { autocracy: "专制", limited: "有限选举", universal: "普选" };
const limitedVoteCountries = new Set(["country_02", "country_04", "country_07", "country_08", "country_12", "country_13", "country_16"]);
export const socialTags = {
  农民: ["下层", "乡民"],
  劳工: ["下层", "工会"],
  工程师: ["中层", "知识分子"],
  文职: ["中层", "小市民"],
  军官: ["中层", "武装部队"],
  军人: ["下层", "武装部队"],
  教士: ["中层", "教会"],
  店主: ["中层", "小市民"],
  资本家: ["上层", "实业家"],
  贵族: ["上层", "地主"],
} as const;
const percent = z.number().min(0).max(100);
export const popSchema = z.object({
  occupation: z.enum(occupations),
  culture: z.string(),
  religion: z.string(),
  people: z.int().nonnegative(),
  wealth: z.number().nonnegative(),
  livingStandard: z.number().min(1).max(30).default(startingLivingStandard),
  literacy: percent,
  radicals: percent,
  loyalists: percent.default(0),
}).refine((pop) => pop.radicals + pop.loyalists <= 100 + 1e-8);
export type Pop = z.infer<typeof popSchema>;

export function mergePopCohorts(target: Pop, arriving: Pop, arrivals: number): Pop {
  const people = target.people + arrivals;
  const average = (key: "wealth" | "livingStandard" | "literacy" | "radicals" | "loyalists") =>
    (target[key] * target.people + arriving[key] * arrivals) / people;
  return {
    ...target, people, wealth: average("wealth"), livingStandard: average("livingStandard"),
    literacy: average("literacy"), radicals: average("radicals"), loyalists: average("loyalists"),
  };
}

const occupationPeople = (pops: readonly Pop[], occupation: Occupation) =>
  pops.reduce((sum, pop) => sum + (pop.occupation === occupation ? pop.people : 0), 0);

function moveOccupationPeople(pops: Pop[], from: Occupation, to: Occupation, peopleNeeded: number, fraction = 1) {
  const sources = pops.filter((pop) => pop.occupation === from && pop.people > 0)
    .map((pop) => ({ pop, available: Math.floor(pop.people * fraction) }));
  const available = sources.reduce((sum, source) => sum + source.available, 0);
  const total = Math.min(available, peopleNeeded);
  if (total === 0) return 0;
  let people = 0, moved = 0;
  for (const source of sources) {
    const { pop } = source;
    people += source.available;
    const cumulative = Math.floor(total * (people / available));
    const leaving = cumulative - moved;
    if (leaving === 0) continue;
    const index = pops.findIndex((other) => other.occupation === to &&
      other.culture === pop.culture && other.religion === pop.religion);
    if (index === -1) pops.push({ ...pop, occupation: to, people: leaving });
    else pops[index] = mergePopCohorts(pops[index], pop, leaving);
    pop.people -= leaving;
    moved = cumulative;
  }
  return moved;
}

export function assignClerkHouseholds(site: SiteSocial, staff: number) {
  const change = Math.ceil(staff / site.laborParticipation) - occupationPeople(site.pops, "文职");
  if (change === 0) return site;
  const pops = site.pops.map((pop) => ({ ...pop }));
  if (change > 0) moveOccupationPeople(pops, "工程师", "文职", change);
  else moveOccupationPeople(pops, "文职", "工程师", -change);
  return { ...site, pops };
}

const recruitableOccupations = ["劳工", "农民"] as const;
export function assignMilitaryHouseholds(site: SiteSocial, regulars: number, conscripts: number, injured: number, laws: readonly Law[]) {
  const participation = site.laborParticipation;
  const total = Math.ceil((regulars + conscripts + injured) / participation);
  const officers = Math.ceil(officersInService(regulars) / participation);
  const needed = { 军官: officers, 军人: total - officers };
  const ranks = ["军官", "军人"] as const;
  const change = ranks.map((rank) => ({ rank, people: needed[rank] - occupationPeople(site.pops, rank) }));
  if (change.every(({ people }) => people === 0)) return site;
  const pops = site.pops.map((pop) => ({ ...pop }));
  for (const { rank, people } of change) {
    if (people < 0) moveOccupationPeople(pops, rank, "劳工", -people);
  }
  for (const { rank, people } of change) {
    let remaining = people;
    for (const civilian of recruitableOccupations) {
      if (remaining <= 0) break;
      const fraction = civilian === "农民" ? 1 - bondedRuralShare(laws) : 1;
      remaining -= moveOccupationPeople(pops, civilian, rank, remaining, fraction);
    }
    if (remaining > 0) throw new Error("军人岗位超过可招募人口");
  }
  return { ...site, pops };
}
export const siteSocialSchema = z.object({
  pops: z.array(popSchema).min(1),
  culturalAffinity: z.record(z.string(), percent).optional(),
  governance: localGovernanceSchema.optional(),
  stability: stabilitySchema.optional(),
  opiumBurden: opiumBurdenSchema.optional(),
  infrastructure: z.int().positive(),
  railway: z.int().nonnegative().default(0),
  port: z.int().nonnegative().default(0),
  electrifyTools: z.int().min(0).max(1).default(0),
  electrifySteel: z.int().min(0).max(1).default(0),
  improveGrain: z.int().min(0).max(1).default(0),
  mechanizeTools: z.int().min(0).max(1).default(0),
  alloySteel: z.int().min(0).max(1).default(0),
  administrativeArchive: z.int().min(0).max(1).default(0),
  productionMethods: z.partialRecord(z.enum(productiveBuildings), z.enum(productionTiers)).optional(),
  university: z.int().nonnegative(),
  bureaucracy: z.int().nonnegative().default(0),
  healthcare: institutionLevelSchema.default(0),
  policing: institutionLevelSchema.default(0),
  welfare: institutionLevelSchema.default(0),
  education: institutionLevelSchema.default(0),
  institutionDuty: institutionDutySchema.optional(),
  populationServices: populationServicesSchema.optional(),
  laborParticipation: z.number().min(0.30).max(0.60).default(0.40),
  construction: z.int().positive(),
  barracks: z.int().nonnegative(),
  barracksTraining: barracksTrainingSchema.optional(),
  battalionOrders: battalionOrdersSchema.optional(),
  militaryHealth: militaryHealthSchema.optional(),
  conscription: z.int().nonnegative(),
});
export type SiteSocial = z.infer<typeof siteSocialSchema>;
export const laws = [
  "工资税改革",
  "地主租佃",
  "小农自耕",
  ...institutionLawKinds.flatMap((kind) => [...institutionLawOptions[kind]]),
  ...laborLaws,
  ...taxLaws,
  ...tradeLaws,
  ...civicLaws,
  ...constitutionalLaws,
  ...governanceLaws,
  ...economicLaws,
  ...opiumLaws,
  ...militaryServiceLaws,
] as const;
export type Law = (typeof laws)[number];
export const techs = ["纺织工艺", "野战后勤", "公共教育", "机械织造", "运输调度", "高等教育", "蒸汽动力", "铁路",
  "规模化钢铁", "电气化", "内燃机", "公共卫生", "劳工保障", "社会保障", "大众政治", "现代税制",
  "常备军组织", "线列训练", "后膛装备", "参谋组织", "连发装备", "现代火炮", "装甲舰艇", "机械化组织",
  "农业改良", "机械工具", "先进材料", "官僚改良"] as const;
export type Tech = (typeof techs)[number];
export const emptyKnowledge = (): Record<Tech, number> => ({
  纺织工艺: 0,
  野战后勤: 0,
  公共教育: 0,
  机械织造: 0,
  运输调度: 0,
  高等教育: 0,
  蒸汽动力: 0,
  铁路: 0,
  规模化钢铁: 0,
  电气化: 0,
  内燃机: 0,
  公共卫生: 0,
  劳工保障: 0,
  社会保障: 0,
  大众政治: 0,
  现代税制: 0,
  常备军组织: 0,
  线列训练: 0,
  后膛装备: 0,
  参谋组织: 0,
  连发装备: 0,
  现代火炮: 0,
  装甲舰艇: 0,
  机械化组织: 0,
  农业改良: 0,
  机械工具: 0,
  先进材料: 0,
  官僚改良: 0,
});
const knowledgeSchema = z.object({
  纺织工艺: percent, 野战后勤: percent, 公共教育: percent, 机械织造: percent, 运输调度: percent, 高等教育: percent,
  蒸汽动力: percent.default(0), 铁路: percent.default(0), 规模化钢铁: percent.default(0), 电气化: percent.default(0),
  内燃机: percent.default(0),
  农业改良: percent.default(0), 机械工具: percent.default(0), 先进材料: percent.default(0),
  官僚改良: percent.default(0),
  公共卫生: percent.default(0),
  劳工保障: percent.default(0),
  社会保障: percent.default(0),
  大众政治: percent.default(0),
  现代税制: percent.default(0),
  常备军组织: percent.default(0),
  线列训练: percent.default(0),
  后膛装备: percent.default(0),
  参谋组织: percent.default(0),
  连发装备: percent.default(0),
  现代火炮: percent.default(0),
  装甲舰艇: percent.default(0),
  机械化组织: percent.default(0),
});
export const privateProject = z.object({
  stateId: z.string(),
  good: z.enum(productiveBuildings),
  weeksLeft: z.number().positive(),
  levels: z.int().positive().optional(),
  ownership: ownershipSchema.optional(),
});
export const facilityTypes = [
  "infrastructure",
  "railway",
  "port",
  "electrifyTools",
  "electrifySteel",
  "improveGrain",
  "mechanizeTools",
  "alloySteel",
  "administrativeArchive",
  "university",
  "bureaucracy",
  "construction",
  "barracks",
  "conscription",
] as const;
export const facilityNames = {
  infrastructure: "交通设施",
  railway: "铁路",
  port: "港口",
  electrifyTools: "工具厂电气化改造",
  electrifySteel: "钢铁厂电气化改造",
  improveGrain: "改良耕作",
  mechanizeTools: "工具厂机械化",
  alloySteel: "钢铁厂先进材料工序",
  administrativeArchive: "行政档案室改造",
  university: "大学",
  bureaucracy: "行政署",
  construction: "建造部门",
  barracks: "兵营",
  conscription: "征兵中心",
};
export const projectTypes = [...productiveBuildings, ...facilityTypes, ...productionProjects] as const;
export const subjectTypes = ["protectorate", "puppet", "vassal"] as const;
export const tributeRate = { protectorate: 0.1, puppet: 0.15, vassal: 0.2 };
export const nationSchema = z.object({
  publicPay: publicPayBandSchema.default("standard"),
  pendingPublicPay: publicPayBandSchema.optional(),
  government: z.array(z.enum(groups)).min(1),
  groupLeadership: leadershipSchema.optional(),
  startingRepresentation: z.literal("limited").optional(),
  startingStateForm: constitutionalFormSchema.optional(),
  laws: z.array(z.enum(laws)).refine((enacted) => institutionLawKinds.every((kind) =>
    enacted.filter((law) => institutionLawDetails(law)?.kind === kind).length <= 1)).refine((enacted) => {
    const categories = enacted.map(laborLawCategory).filter((category) => category !== undefined);
    const civicCategories = enacted.map(civicLawCategory).filter((category) => category !== undefined);
    return new Set(categories).size === categories.length && new Set(civicCategories).size === civicCategories.length;
  }).refine((enacted) => enacted.filter(isTaxLaw).length <= 1 && enacted.filter(isTradeLaw).length <= 1 &&
    enacted.filter(isOpiumLaw).length <= 1 && enacted.filter(isMilitaryServiceLaw).length <= 1 &&
    enacted.filter(isGovernanceLaw).length <= 1 && enacted.filter(isEconomicLaw).length <= 1 &&
    (["stateForm", "representation"] as const).every((category) =>
      enacted.filter((law) => constitutionLawCategory(law) === category).length <= 1)),
  taxBand: taxBandSchema.default(taxBands[2]),
  exciseGoods: exciseGoodsSchema.default(() => [...exciseGoods]),
  tariffBand: tariffBandSchema.default("standard"),
  tradePartners: tradePartnersSchema.default(() => []),
  reform: z.enum(laws).nullable(),
  reformProgress: z.number().nonnegative(),
  reformConsultation: z.object({ law: z.enum(laws), endsDay: z.int().positive() }).optional(),
  research: z.enum(techs).nullable(),
  knowledge: knowledgeSchema,
  diffusion: knowledgeSchema,
  investment: z.int().nonnegative(),
  privateQueue: z.array(privateProject),
  infamy: z.number().nonnegative(),
  lastThreatDay: z.int().nonnegative().optional(),
  marketLeader: z.string().nullable(),
  overlord: z.string().nullable(),
  subjectType: z.enum(subjectTypes).nullable(),
  interests: z.array(z.string()),
  prestige: z.int(),
  convoys: z.int().nonnegative(),
  fleet: merchantFleetSchema.default(initialFleet),
  navy: navySchema.default(() => initialNavy()),
  morale: percent,
  generalRank: z.int().min(1).max(5),
});
export type Nation = z.infer<typeof nationSchema>;
export const hash = (s: string) => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 1820);
const startingShares = [0.69, 0.18, 0.018, 0.012, 0.02, 0.05, 0.01, 0.02];
export function initSiteSociety(site: Scenario["states"][string]): SiteSocial {
  const pops: Pop[] = [];
  let remainder = site.population;
  for (const [i, occupation] of startingOccupations.entries()) {
    const total =
      i === startingOccupations.length - 1 ? remainder : Math.floor(site.population * startingShares[i]);
    remainder -= total;
    const minority = Math.floor(total * 0.12);
    for (const foreign of [false, true]) {
      const rank = i < 2 ? 1 : i < 6 ? 2 : 3;
      pops.push({
        occupation,
        people: foreign ? minority : total - minority,
        culture: foreign ? "地方文化-" + site.id : site.ownerId ?? "本地文化-" + site.id,
        religion: foreign ? "地方信仰-" + site.id : site.ownerId ?? "本地信仰-" + site.id,
        wealth: rank * rank * 4,
        livingStandard: startingLivingStandard,
        literacy: 12 * rank + (hash(site.id) % 10),
        radicals: 0,
        loyalists: foreign ? 0 : 15,
      });
    }
  }
  return {
    pops,
    culturalAffinity: initialCulturalAffinity(pops),
    stability: emptyStability(),
    infrastructure: 1 + (hash(site.id) % 3),
    railway: 0,
    port: 0,
    electrifyTools: 0,
    electrifySteel: 0,
    improveGrain: 0,
    mechanizeTools: 0,
    alloySteel: 0,
    administrativeArchive: 0,
    university: 0,
    bureaucracy: site.startingOffices ?? 0,
    healthcare: 0,
    policing: 0,
    welfare: 0,
    education: 0,
    laborParticipation: 0.40,
    construction: 1,
    barracks: 1,
    conscription: 1,
  };
}
export function initSociety(scenario: Scenario, seed = 1820) {
  const societies: Record<string, SiteSocial> = {};
  const nations: Record<string, Nation> = {};
  const coastalByOwner: Record<string, number> = {};
  for (const site of Object.values(scenario.states)) {
    if (site.ownerId === null) continue;
    societies[site.id] = initSiteSociety(site);
    if (site.coastal) coastalByOwner[site.ownerId] = (coastalByOwner[site.ownerId] ?? 0) + 1;
  }
  for (const id of Object.keys(scenario.countries)) {
    nations[id] = {
      publicPay: "standard",
      startingStateForm: startingStateForm(id),
      ...(limitedVoteCountries.has(id) ? { startingRepresentation: "limited" as const } : {}),
      government: ["地主", "乡民"],
      groupLeadership: initialGroupLeadership(id, seed),
      laws: [...institutionLawKinds.map((kind) => institutionLawOptions[kind][0]), ...startingLaborLaws(id),
        taxLaws[0], tradeLaws[0], "职业常备军"],
      taxBand: "standard",
      exciseGoods: [...exciseGoods],
      tariffBand: "standard",
      tradePartners: [],
      reform: null,
      reformProgress: 0,
      research: null,
      knowledge: emptyKnowledge(),
      diffusion: emptyKnowledge(),
      investment: 0,
      privateQueue: [],
      infamy: 0,
      marketLeader: null,
      overlord: null,
      subjectType: null,
      interests: [],
      prestige: 100,
      convoys: 4,
      fleet: initialFleet(),
      navy: initialNavy(coastalByOwner[id]),
      generalRank: 1,
      morale: 100,
    };
  }
  return { societies, nations };
}

function populationAverage(pops: Pop[], metric: "literacy" | "livingStandard" | "radicals" | "loyalists") {
  const people = pops.reduce((n, p) => n + p.people, 0);
  return people ? pops.reduce((n, p) => n + p.people * p[metric], 0) / people : 0;
}
export const literacyOf = (pops: Pop[]) => populationAverage(pops, "literacy");
export const livingStandardOf = (pops: Pop[]) => populationAverage(pops, "livingStandard");
export const unrestOf = (pops: Pop[]) => populationAverage(pops, "radicals");
export function politicalAttitudes(pops: Pop[]) {
  const radicals = unrestOf(pops), loyalists = populationAverage(pops, "loyalists");
  return { radicals, loyalists, neutral: Math.max(0, 100 - radicals - loyalists) };
}
export { powerDistribution } from "./constitution.ts";

export function initialGroupLeadership(id: string, seed: number): GroupLeadership {
  return Object.fromEntries(groups.map((group) => [
    group, { ability: 50 + hash(`${seed}/${id}/${group}`) % 31, experience: 0 },
  ])) as GroupLeadership;
}

export function advanceGroupLeadership(nation: Nation, id: string, seed: number): Nation {
  const leadership = nation.groupLeadership ?? initialGroupLeadership(id, seed);
  const groupLeadership = { ...leadership };
  for (const group of nation.government) {
    const leader = leadership[group];
    if (leader.experience < 24) groupLeadership[group] = { ...leader, experience: leader.experience + 1 };
  }
  return { ...nation, groupLeadership };
}

const localMovements = {
  hardship: ["乡民", "工会"],
  exclusion: ["知识分子", "工会"],
  war: ["武装部队"],
  politics: ["知识分子", "小市民"],
} satisfies Record<NonNullable<LocalStability["incident"]>["cause"], readonly Group[]>;

export function politicalRepresentation(locals: SiteSocial[], id: string, nation: Nation) {
  const points = Object.fromEntries(groups.map((group) => [group, 0])) as Record<Group, number>;
  const supporters = { ...points };
  const leadership = nation.groupLeadership ?? initialGroupLeadership(id, 1820);
  const weights = votingWeights[powerDistribution(nation)];
  const civicRights = nation.laws.includes("妇女平等权") ? { 下层: 1.15, 中层: 1.10, 上层: 1 } :
    { 下层: 1, 中层: 1, 上层: 1 };
  const ruralFreedom = 1 - bondedRuralShare(nation.laws);
  const policy = civicPolicy(nation.laws);
  const government = new Set(nation.government);
  const mobilized = nation.knowledge["大众政治"] === 100;
  const organization = Object.fromEntries(groups.map((group) => {
    const leader = leadership[group];
    const emerging = group === "工会" && !mobilized ? 0.65 :
      group === "实业家" && nation.knowledge["机械工具"] !== 100 ? 0.80 : 1;
    return [group, emerging * (0.85 + leader.ability / 400 + leader.experience / 300)];
  })) as Record<Group, number>;
  const views = Object.fromEntries(groups.map((group) => [
    group, Math.max(-0.18, Math.min(0.18, (approval(nation, group) - (government.has(group) ? 8 : 0)) / 100)),
  ])) as Record<Group, number>;
  let population = 0;
  for (const site of locals) {
    const incident = site.stability?.incident;
    const movement: readonly Group[] = incident && !incident.negotiated ? localMovements[incident.cause] : [];
    for (const pop of site.pops) {
      const stratum = socialTags[pop.occupation][0];
      const standing = civicStanding(pop, id, site, policy);
      const weight = pop.people * weights[stratum] * civicRights[stratum] *
        (pop.occupation === "农民" ? ruralFreedom : 1) * (0.05 + 0.95 * standing);
      const attitude = (pop.loyalists - pop.radicals) / 100;
      const hardTimes = Math.max(0, 10 - pop.livingStandard) / 10;
      const choices = occupationSupport[pop.occupation].map(([group, base]) => {
        const trust = attitude * (government.has(group) ? 0.24 : -0.16);
        const hardship = group === "乡民" || group === "工会" ? 0.20 * hardTimes : 0;
        const exclusion = group === "知识分子" || group === "工会" ? 0.12 * (1 - standing) : 0;
        return { group, share: base * (1 + views[group] + trust + hardship + exclusion + (movement.includes(group) ? 0.15 : 0)) };
      });
      const total = choices.reduce((sum, choice) => sum + choice.share, 0);
      for (const { group, share } of choices) {
        supporters[group] += pop.people * share / total;
        points[group] += weight * share / total * organization[group];
      }
      population += pop.people;
    }
  }
  const power = groups.reduce((sum, group) => sum + points[group], 0);
  for (const group of groups) {
    points[group] = power > 0 ? 100 * points[group] / power : 0;
    supporters[group] = population > 0 ? 100 * supporters[group] / population : 0;
  }
  return { influence: points, supporters, organization, leadership };
}

export function influence(locals: SiteSocial[], id: string, nation: Nation) {
  return politicalRepresentation(locals, id, nation).influence;
}
export const supporters: Record<Law, Group[]> = {
  地方民兵: ["乡民", "小市民"],
  职业常备军: ["武装部队", "地主"],
  义务兵役: ["武装部队", "知识分子"],
  鸦片许可经营: ["实业家", "地主"],
  鸦片限医疗: ["知识分子", "小市民", "教会"],
  鸦片禁令: ["教会", "乡民", "武装部队"],
  工资税改革: ["实业家", "小市民"],
  平等公民权: ["知识分子", "工会"],
  信仰自由: ["知识分子", "小市民"],
  普选制: ["工会", "乡民"],
  干预主义: ["乡民", "小市民"],
  自由放任: ["实业家", "小市民"],
  国家主导: ["地主", "武装部队", "小市民"],
  合作经济: ["工会", "乡民", "知识分子"],
  出版自由: ["知识分子", "实业家"],
  地主租佃: ["地主"],
  小农自耕: ["乡民", "小市民"],
  地方教育: ["教会", "地主"],
  公共学校: ["知识分子", "乡民"],
  普及教育: ["知识分子", "工会", "小市民"],
  地方诊疗: ["地主", "教会"],
  公共诊疗: ["小市民", "知识分子", "乡民"],
  普及医疗: ["知识分子", "工会", "乡民"],
  地方救济: ["教会", "地主"],
  公共救济: ["乡民", "工会", "教会"],
  社会保险: ["工会", "乡民", "小市民"],
  自由劳动: ["乡民", "知识分子", "工会", "实业家"],
  奴隶制: ["地主"],
  农奴制: ["地主", "教会"],
  身份劳役: ["地主", "武装部队"],
  普通雇佣: ["实业家", "地主"],
  工时与工伤保障: ["工会", "乡民", "小市民"],
  集体劳动保障: ["工会", "知识分子", "乡民"],
  传统性别分工: ["教会", "地主"],
  妇女就业权: ["实业家", "小市民", "乡民"],
  妇女平等权: ["知识分子", "工会", "乡民"],
  传统土地身份税: ["乡民", "小市民"],
  比例所得税: ["实业家", "小市民", "知识分子"],
  累进所得税: ["工会", "乡民", "知识分子"],
  消费税制: ["实业家", "地主"],
  贸易保护: ["乡民", "实业家"],
  自由贸易: ["实业家", "小市民", "知识分子"],
  许可贸易: ["地主", "武装部队"],
  本族公民权: ["地主", "武装部队"],
  有限公民权: ["小市民", "实业家", "乡民"],
  国教优先: ["教会", "地主"],
  宗教宽容: ["知识分子", "小市民", "乡民"],
  出版审查: ["地主", "武装部队"],
  有限出版: ["小市民", "实业家", "乡民"],
  君主制: ["地主", "武装部队", "教会"],
  共和制: ["实业家", "知识分子", "小市民", "乡民"],
  教权政体: ["教会", "地主"],
  专制统治: ["地主", "武装部队"],
  有限选举: ["实业家", "小市民", "乡民"],
  复合辖区制: ["地主", "乡民"],
  中央集权: ["地主", "武装部队", "小市民"],
  地方自治: ["乡民", "小市民", "知识分子"],
  殖民特许: ["实业家", "地主", "武装部队"],
};
export function approval(nation: Nation, g: Group) {
  return (
    (nation.government.includes(g) ? 8 : 0) +
    nation.laws.reduce((n, l) => institutionLawDetails(l)?.level === 1 || neutralLaborLaws.has(l) ||
      l === "传统土地身份税" || l === "贸易保护" || l === "复合辖区制" || l === "国家主导" ||
      l === "职业常备军" || isBaselineCivicLaw(l) ?
      n : n + (supporters[l].includes(g) ? 4 : -1), 0)
  );
}
export const reformWork = 2;
export const baselineReformWeeks = 26;
export const reformConsultationDays = 28;
export function reformStage(work: number): "organization" | "debate" | "implementation" {
  return work < reformWork / 3 ? "organization" : work < 2 * reformWork / 3 ? "debate" : "implementation";
}
export function governmentLegitimacy(nation: Nation, power: Record<Group, number>) {
  const government = nation.government;
  const conflict =
    (government.includes("地主") && government.includes("工会") ? 50 : 0) +
    (government.includes("教会") && government.includes("知识分子") ? 50 : 0);
  const governmentPower = government.reduce((sum, group) => sum + power[group], 0);
  const institutionalSupport = groups.reduce((sum, group) => {
    const policyApproval = approval(nation, group) - (government.includes(group) ? 8 : 0);
    return sum + power[group] * Math.max(0, Math.min(1, 0.5 + policyApproval / 20));
  }, 0);
  const mandateGroups = powerDistribution(nation) === "autocracy" ? constitutionalMandate(nation)
    : [...groups].sort((a, b) => power[b] - power[a]).slice(0, government.length);
  const mandate = 100 * government.filter((group) => mandateGroups.includes(group)).length / government.length;
  return Math.round(Math.max(0, Math.min(100,
    0.45 * institutionalSupport + 0.35 * governmentPower + 0.20 * mandate - 0.30 * conflict,
  )));
}
export function reformConditions(nation: Nation, power: Record<Group, number>, law: Law, unrest = 0, elapsedDay = 0) {
  const government = nation.government;
  const legitimacy = governmentLegitimacy(nation, power);
  const support = Math.min(100, supporters[law].reduce((n, g) => n + power[g], 0) * civicPolicy(nation.laws).organization);
  const backed = government.some((g) => supporters[law].includes(g)) || support >= 25;
  const stage = reformStage(nation.reform === law ? nation.reformProgress : 0);
  const consultation = nation.reformConsultation?.law === law ? nation.reformConsultation : undefined;
  const hearing = consultation ? Math.max(0, consultation.endsDay - elapsedDay) : 0;
  const negotiated = consultation !== undefined && hearing === 0;
  const resistance = Math.max(0, Math.min(100, unrest + Math.max(0, 55 - support) * 0.65) - (negotiated ? 25 : 0));
  const disputed = stage === "debate" && resistance >= 35;
  const pace = Math.max(0.25, 1 + (legitimacy - 50) / 50 + (support - 50) / 50 - resistance / 100 - (disputed ? 0.20 : 0));
  const weeks = Math.max(8, Math.min(104, Math.round(baselineReformWeeks / pace)));
  return { legitimacy, support, backed, weeks, resistance, disputed, stage, hearing, negotiated,
    speed: backed && legitimacy >= 25 && hearing === 0 ? reformWork / weeks : 0 };
}
export function evolvePops(
  site: SiteSocial,
  id: string,
  nation: Nation,
  week: {
    grainPrice: number; laborWages: number; specialistWages: number; clerkWages: number;
    enlistedWages: number; officerWages: number;
    capitalistIncome: number; landownerIncome: number; ruralResources: number; businessJobs: number; standardTarget: number;
    taxBurden: number; warPressure: number;
    relief?: { 农民: number; 劳工: number };
  },
  tuning: RuleTuning,
) {
  const { grainPrice, laborWages, specialistWages, clerkWages, capitalistIncome, landownerIncome, ruralResources,
    businessJobs, standardTarget } = week;
  const totals = Object.fromEntries(
    occupations.map((o) => [o, site.pops.reduce((s, p) => s + (p.occupation === o ? p.people : 0), 0)]),
  ) as Record<Occupation, number>;
  const boundShare = bondedRuralShare(nation.laws);
  const employed = Math.min(1, businessJobs / Math.max(1, workForce(totals.劳工, site.laborParticipation)));
  const protection = laborProtection(nation.laws).relief * employed;
  const policy = civicPolicy(nation.laws);
  const restrictedVoice = powerDistribution(nation) === "autocracy";
  const occupationIncome: Record<Occupation, number> = {
    农民: ruralResources + (week.relief?.农民 ?? 0), 劳工: laborWages + (week.relief?.劳工 ?? 0),
    工程师: specialistWages, 文职: clerkWages,
    军官: week.officerWages, 军人: week.enlistedWages, 教士: totals.教士 * 4, 店主: totals.店主 * 4,
    资本家: capitalistIncome, 贵族: landownerIncome,
  };
  const pops = site.pops.map((p) => {
    const standing = civicStanding(p, id, site, policy);
    const income = occupationIncome[p.occupation];
    const living = Math.max(
      0.5,
      (((income / Math.max(1, totals[p.occupation])) * 0.3) / (grainPrice / 100)) * (0.65 + 0.35 * standing),
    );
    const wealth = Math.max(0.5, p.wealth * 0.96 + Math.min(150, living) * 0.04);
    const suffering = wealth < 4 + p.literacy / 12 + (nation.knowledge["公共教育"] === 100 ? 1 : 0);
    const group = socialTags[p.occupation][1];
    const threatenedByReform = nation.reform !== null && !supporters[nation.reform].includes(group) &&
      !nation.government.includes(group);
    const pressure = (suffering ? 0.25 : -0.18) +
      (p.occupation === "农民" ? 0.08 * boundShare : p.occupation === "劳工" ? 0.14 * (1 - employed) - protection : 0) +
      0.12 * (1 - standing) + 0.024 * Math.max(0, p.livingStandard - standardTarget) +
      0.24 * Math.max(0, week.taxBurden - 0.12) + week.warPressure +
      (restrictedVoice && socialTags[p.occupation][0] === "下层" ? 0.035 : 0) +
      (threatenedByReform ? 0.08 : 0);
    const change = pressure * (pressure > 0 ? tuning.radicalGrowth : tuning.radicalRelief);
    const radicals = Math.max(0, Math.min(100, p.radicals + change));
    const loyalists = Math.max(0, Math.min(100 - radicals, p.loyalists - 0.65 * change));
    const livingStandard = updateLivingStandard(p.livingStandard, standardTarget);
    return { ...p, wealth, radicals, loyalists, livingStandard };
  });
  // Fill commercial vacancies from rural households of the same identity.
  const targetLabourers = Math.ceil(businessJobs / site.laborParticipation);
  let vacancies = Math.max(0, targetLabourers - totals["劳工"]);
  for (const rural of pops.filter((p) => p.occupation === "农民")) {
    const hired = Math.min(rural.people, vacancies, Math.ceil(rural.people * 0.02 * (1 - boundShare)));
    if (!hired) continue;
    const index = pops.findIndex((p) => p.occupation === "劳工" && p.culture === rural.culture && p.religion === rural.religion);
    if (index === -1) pops.push({ ...rural, occupation: "劳工", people: hired });
    else pops[index] = mergePopCohorts(pops[index], rural, hired);
    rural.people -= hired;
    vacancies -= hired;
  }
  // Workers qualify for new technical posts in their own culture/religion cohort.
  for (const p of pops.filter((p) => p.occupation === "劳工")) {
    const index = pops.findIndex((e) => e.occupation === "工程师" && e.culture === p.culture && e.religion === p.religion);
    const engineers = (index === -1 ? 0 : pops[index].people) + pops.reduce((sum, clerk) =>
      sum + (clerk.occupation === "文职" && clerk.culture === p.culture && clerk.religion === p.religion ? clerk.people : 0), 0);
    const vacancies = Math.max(
      0,
      Math.ceil((businessJobs * 0.12 * p.people) / Math.max(1, totals["劳工"])) - engineers,
    );
    const qualified = Math.floor(
      ((p.people * (p.literacy + p.wealth)) / 1000) *
        (1 + site.university) *
        (0.35 + 0.65 * civicStanding(p, id, site, policy)),
    );
    const promoted = Math.min(p.people, vacancies, qualified);
    if (!promoted) continue;
    if (index === -1) pops.push({ ...p, occupation: "工程师", people: promoted });
    else pops[index] = mergePopCohorts(pops[index], p, promoted);
    p.people -= promoted;
  }
  const laborParticipation = site.laborParticipation + 0.1 * (participationTarget(nation.laws) - site.laborParticipation);
  return { ...site, pops, laborParticipation };
}
