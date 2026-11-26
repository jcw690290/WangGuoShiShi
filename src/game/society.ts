import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";
import type { RuleTuning } from "./settings.ts";
import { startingLivingStandard, updateLivingStandard } from "./households.ts";
import { initialCulturalAffinity } from "./culture.ts";
import { localGovernanceSchema } from "./governance.ts";
import { emptyStability, stabilitySchema } from "./unrest.ts";
import { goods } from "./industry.ts";
import { initialFleet, merchantFleetSchema } from "./fleet.ts";

export const occupations = ["农民", "劳工", "工程师", "军官", "教士", "店主", "资本家", "贵族"] as const;
export type Occupation = (typeof occupations)[number];
export const groups = ["乡民", "工会", "知识分子", "武装部队", "教会", "小市民", "实业家", "地主"] as const;
export type Group = (typeof groups)[number];
const occupationSupport: Record<Occupation, readonly (readonly [Group, number])[]> = {
  农民: [["乡民", 0.70], ["地主", 0.20], ["教会", 0.10]],
  劳工: [["工会", 0.55], ["小市民", 0.15], ["教会", 0.15], ["武装部队", 0.05], ["实业家", 0.05], ["乡民", 0.05]],
  工程师: [["知识分子", 0.40], ["工会", 0.30], ["实业家", 0.20], ["小市民", 0.10]],
  军官: [["武装部队", 0.80], ["小市民", 0.10], ["地主", 0.10]],
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
  军官: ["中层", "武装部队"],
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
});
export type Pop = z.infer<typeof popSchema>;
export const siteSocialSchema = z.object({
  pops: z.array(popSchema).min(1),
  culturalAffinity: z.record(z.string(), percent).optional(),
  governance: localGovernanceSchema.optional(),
  stability: stabilitySchema.optional(),
  infrastructure: z.int().positive(),
  railway: z.int().nonnegative().default(0),
  port: z.int().nonnegative().default(0),
  electrifyTools: z.int().min(0).max(1).default(0),
  electrifySteel: z.int().min(0).max(1).default(0),
  university: z.int().nonnegative(),
  bureaucracy: z.int().nonnegative().default(0),
  construction: z.int().positive(),
  barracks: z.int().nonnegative(),
  conscription: z.int().nonnegative(),
});
export type SiteSocial = z.infer<typeof siteSocialSchema>;
export const laws = [
  "工资税改革",
  "平等公民权",
  "信仰自由",
  "普选制",
  "干预主义",
  "自由放任",
  "出版自由",
  "地主租佃",
  "小农自耕",
] as const;
export type Law = (typeof laws)[number];
export const techs = ["纺织工艺", "野战后勤", "公共教育", "机械织造", "运输调度", "高等教育", "蒸汽动力", "铁路", "规模化钢铁", "电气化"] as const;
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
});
const knowledgeSchema = z.object({
  纺织工艺: percent, 野战后勤: percent, 公共教育: percent, 机械织造: percent, 运输调度: percent, 高等教育: percent,
  蒸汽动力: percent.default(0), 铁路: percent.default(0), 规模化钢铁: percent.default(0), 电气化: percent.default(0),
});
export const privateProject = z.object({
  stateId: z.string(),
  good: z.enum(goods),
  weeksLeft: z.number().positive(),
  levels: z.int().positive().optional(),
});
export const facilityTypes = [
  "infrastructure",
  "railway",
  "port",
  "electrifyTools",
  "electrifySteel",
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
  university: "大学",
  bureaucracy: "行政署",
  construction: "建造部门",
  barracks: "兵营",
  conscription: "征兵中心",
};
export const projectTypes = [...goods, ...facilityTypes] as const;
export const subjectTypes = ["protectorate", "puppet", "vassal"] as const;
export const tributeRate = { protectorate: 0.1, puppet: 0.15, vassal: 0.2 };
export const nationSchema = z.object({
  government: z.array(z.enum(groups)).min(1),
  startingRepresentation: z.literal("limited").optional(),
  laws: z.array(z.enum(laws)),
  reform: z.enum(laws).nullable(),
  reformProgress: z.number().nonnegative(),
  research: z.enum(techs).nullable(),
  knowledge: knowledgeSchema,
  diffusion: knowledgeSchema,
  investment: z.int().nonnegative(),
  privateQueue: z.array(privateProject),
  infamy: z.number().nonnegative(),
  marketLeader: z.string().nullable(),
  overlord: z.string().nullable(),
  subjectType: z.enum(subjectTypes).nullable(),
  interests: z.array(z.string()),
  prestige: z.int(),
  convoys: z.int().nonnegative(),
  fleet: merchantFleetSchema.default(initialFleet),
  morale: percent,
  generalRank: z.int().min(1).max(5),
});
export type Nation = z.infer<typeof nationSchema>;
export const hash = (s: string) => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 1820);
const startingShares = [0.69, 0.18, 0.018, 0.012, 0.02, 0.05, 0.01, 0.02];
export function initSiteSociety(site: Scenario["states"][string]): SiteSocial {
  const pops: Pop[] = [];
  let remainder = site.population;
  for (const [i, occupation] of occupations.entries()) {
    const total =
      i === occupations.length - 1 ? remainder : Math.floor(site.population * startingShares[i]);
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
    university: 0,
    bureaucracy: site.startingOffices ?? 0,
    construction: 1,
    barracks: 1,
    conscription: 1,
  };
}
export function initSociety(scenario: Scenario) {
  const societies: Record<string, SiteSocial> = {};
  const nations: Record<string, Nation> = {};
  for (const site of Object.values(scenario.states))
    if (site.ownerId !== null) societies[site.id] = initSiteSociety(site);
  for (const id of Object.keys(scenario.countries)) {
    nations[id] = {
      ...(limitedVoteCountries.has(id) ? { startingRepresentation: "limited" as const } : {}),
      government: ["地主", "乡民"],
      laws: [],
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
      generalRank: 1,
      morale: 100,
    };
  }
  return { societies, nations };
}

export function accepted(pop: Pop, id: string, nation: Nation) {
  return (
    (nation.laws.includes("平等公民权") || pop.culture === id) &&
    (nation.laws.includes("信仰自由") || pop.religion === id)
  );
}
function populationAverage(pops: Pop[], metric: "literacy" | "livingStandard" | "radicals") {
  const people = pops.reduce((n, p) => n + p.people, 0);
  return people ? pops.reduce((n, p) => n + p.people * p[metric], 0) / people : 0;
}
export const literacyOf = (pops: Pop[]) => populationAverage(pops, "literacy");
export const livingStandardOf = (pops: Pop[]) => populationAverage(pops, "livingStandard");
export const unrestOf = (pops: Pop[]) => populationAverage(pops, "radicals");
export function powerDistribution(nation: Nation): keyof typeof votingWeights {
  return nation.laws.includes("普选制") ? "universal" : nation.startingRepresentation ?? "autocracy";
}

export function influence(locals: SiteSocial[], id: string, nation: Nation) {
  const points = Object.fromEntries(groups.map((g) => [g, 0])) as Record<Group, number>;
  const weights = votingWeights[powerDistribution(nation)];
  let sum = 0;
  for (const { pops } of locals)
    for (const pop of pops) {
      const weight =
        pop.people *
        weights[socialTags[pop.occupation][0]] *
        (accepted(pop, id, nation) ? 1 : 0.05);
      for (const [group, support] of occupationSupport[pop.occupation]) points[group] += weight * support;
      sum += weight;
    }
  for (const g of groups) points[g] = sum ? (100 * points[g]) / sum : 0;
  return points;
}
export const supporters: Record<Law, Group[]> = {
  工资税改革: ["实业家", "小市民"],
  平等公民权: ["知识分子", "工会"],
  信仰自由: ["知识分子", "小市民"],
  普选制: ["工会", "乡民"],
  干预主义: ["乡民", "小市民"],
  自由放任: ["实业家", "小市民"],
  出版自由: ["知识分子", "实业家"],
  地主租佃: ["地主"],
  小农自耕: ["乡民", "小市民"],
};
export function approval(nation: Nation, g: Group) {
  return (
    (nation.government.includes(g) ? 8 : 0) +
    nation.laws.reduce((n, l) => n + (supporters[l].includes(g) ? 4 : -1), 0)
  );
}
export const reformWork = 2;
export const baselineReformWeeks = 26;
const recognizedSuccessors: Group[] = ["地主", "教会", "武装部队"];
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
  const mandateGroups = powerDistribution(nation) === "autocracy" ? recognizedSuccessors
    : [...groups].sort((a, b) => power[b] - power[a]).slice(0, government.length);
  const mandate = 100 * government.filter((group) => mandateGroups.includes(group)).length / government.length;
  return Math.round(Math.max(0, Math.min(100,
    0.45 * institutionalSupport + 0.35 * governmentPower + 0.20 * mandate - 0.30 * conflict,
  )));
}
export function reformConditions(nation: Nation, power: Record<Group, number>, law: Law, resistance = 0) {
  const government = nation.government;
  const legitimacy = governmentLegitimacy(nation, power);
  const support = supporters[law].reduce((n, g) => n + power[g], 0);
  const backed = government.some((g) => supporters[law].includes(g)) || support >= 25;
  const pace = Math.max(0.25, 1 + (legitimacy - 50) / 50 + (support - 50) / 50 - resistance / 100);
  const weeks = Math.max(8, Math.min(104, Math.round(baselineReformWeeks / pace)));
  return { legitimacy, support, backed, weeks, resistance, speed: backed && legitimacy >= 25 ? reformWork / weeks : 0 };
}
export function evolvePops(
  site: SiteSocial,
  id: string,
  nation: Nation,
  week: {
    grainPrice: number; laborWages: number; specialistWages: number;
    dividends: number; ruralResources: number; landRent: number; businessJobs: number; standardTarget: number;
  },
  tuning: RuleTuning,
) {
  const { grainPrice, laborWages, specialistWages, dividends, ruralResources, landRent, businessJobs, standardTarget } = week;
  const totals = Object.fromEntries(
    occupations.map((o) => [o, site.pops.reduce((s, p) => s + (p.occupation === o ? p.people : 0), 0)]),
  ) as Record<Occupation, number>;
  const pops = site.pops.map((p) => {
    const isAccepted = accepted(p, id, nation);
    const income =
      p.occupation === "农民"
        ? ruralResources
        : p.occupation === "劳工"
          ? laborWages
          : socialTags[p.occupation][0] === "上层"
            ? dividends / 2 + (p.occupation === "贵族" ? landRent : 0)
            : totals[p.occupation] * 4 + (p.occupation === "工程师" ? specialistWages : 0);
    const living = Math.max(
      0.5,
      (((income / Math.max(1, totals[p.occupation])) * 0.3) / (grainPrice / 100)) * (isAccepted ? 1 : 0.65),
    );
    const wealth = Math.max(0.5, p.wealth * 0.96 + Math.min(150, living) * 0.04);
    const suffering = wealth < 4 + p.literacy / 12 + (nation.knowledge["公共教育"] === 100 ? 1 : 0);
    const radicals = Math.max(
      0,
      Math.min(
        100,
        p.radicals +
          (suffering ? 0.25 * tuning.radicalGrowth : -0.18 * tuning.radicalRelief) +
          (isAccepted ? 0 : 0.12 * tuning.radicalGrowth),
      ),
    );
    const livingStandard = updateLivingStandard(p.livingStandard, standardTarget);
    return { ...p, wealth, radicals, livingStandard };
  });
  // Fill commercial vacancies from rural households of the same identity.
  const targetLabourers = Math.ceil(businessJobs / 0.4);
  let vacancies = Math.max(0, targetLabourers - totals["劳工"]);
  for (const rural of pops.filter((p) => p.occupation === "农民")) {
    const labour = pops.find((p) => p.occupation === "劳工" && p.culture === rural.culture)!;
    const hired = Math.min(rural.people, vacancies, Math.ceil(rural.people * 0.02));
    rural.people -= hired;
    labour.people += hired;
    vacancies -= hired;
  }
  // Workers qualify for new technical posts in their own culture/religion cohort.
  for (const p of pops.filter((p) => p.occupation === "劳工")) {
    const engineers = pops.find((e) => e.occupation === "工程师" && e.culture === p.culture)!;
    const vacancies = Math.max(
      0,
      Math.ceil((businessJobs * 0.12 * p.people) / Math.max(1, totals["劳工"])) - engineers.people,
    );
    const qualified = Math.floor(
      ((p.people * (p.literacy + p.wealth)) / 1000) *
        (1 + site.university) *
        (accepted(p, id, nation) ? 1 : 0.35),
    );
    const promoted = Math.min(p.people, vacancies, qualified);
    p.people -= promoted;
    engineers.people += promoted;
  }
  return { ...site, pops };
}
