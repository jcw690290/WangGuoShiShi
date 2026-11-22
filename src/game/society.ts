import { z } from "zod";
import type { Scenario } from "../scenario/scenario.ts";

export const occupations = ["农民", "劳工", "工程师", "军官", "教士", "店主", "资本家", "贵族"] as const;
export type Occupation = (typeof occupations)[number];
export const groups = ["乡民", "工会", "知识分子", "武装部队", "教会", "小市民", "实业家", "地主"] as const;
export type Group = (typeof groups)[number];
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
  literacy: percent,
  radicals: percent,
});
export type Pop = z.infer<typeof popSchema>;
export const siteSocialSchema = z.object({
  pops: z.array(popSchema).min(1),
  infrastructure: z.int().positive(),
  university: z.int().nonnegative(),
  construction: z.int().positive(),
  barracks: z.int().nonnegative(),
  conscription: z.int().nonnegative(),
  arsenal: z.int().nonnegative(),
  ammunition: z.int().nonnegative(),
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
] as const;
export type Law = (typeof laws)[number];
export const techs = ["纺织工艺", "野战后勤", "公共教育", "机械织造", "运输调度", "高等教育"] as const;
export type Tech = (typeof techs)[number];
export const emptyKnowledge = (): Record<Tech, number> => ({
  纺织工艺: 0,
  野战后勤: 0,
  公共教育: 0,
  机械织造: 0,
  运输调度: 0,
  高等教育: 0,
});
export const privateProject = z.object({
  stateId: z.string(),
  good: z.enum(["grain", "cloth"]),
  weeksLeft: z.number().positive(),
});
export const facilityTypes = [
  "infrastructure",
  "university",
  "construction",
  "barracks",
  "conscription",
  "arsenal",
  "ammunition",
] as const;
export const facilityNames = {
  infrastructure: "交通设施",
  university: "大学",
  construction: "建造部门",
  barracks: "兵营",
  conscription: "征兵中心",
  arsenal: "兵工厂",
  ammunition: "弹药厂",
};
export const projectTypes = ["grain", "cloth", ...facilityTypes] as const;
export const subjectTypes = ["protectorate", "puppet", "vassal"] as const;
export const tributeRate = { protectorate: 0.1, puppet: 0.15, vassal: 0.2 };
export const nationSchema = z.object({
  government: z.array(z.enum(groups)).min(1),
  laws: z.array(z.enum(laws)),
  reform: z.enum(laws).nullable(),
  reformProgress: z.number().nonnegative(),
  research: z.enum(techs).nullable(),
  knowledge: z.record(z.enum(techs), percent),
  diffusion: z.record(z.enum(techs), percent),
  investment: z.int().nonnegative(),
  privateQueue: z.array(privateProject),
  infamy: z.number().nonnegative(),
  marketLeader: z.string().nullable(),
  overlord: z.string().nullable(),
  subjectType: z.enum(subjectTypes).nullable(),
  interests: z.array(z.string()),
  prestige: z.int(),
  convoys: z.int().nonnegative(),
  morale: percent,
  generalRank: z.int().min(1).max(5),
});
export type Nation = z.infer<typeof nationSchema>;
export const hash = (s: string) => [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 1820);
const startingShares = [0.69, 0.18, 0.018, 0.012, 0.02, 0.05, 0.01, 0.02];
export function initSociety(scenario: Scenario) {
  const societies: Record<string, SiteSocial> = {};
  const nations: Record<string, Nation> = {};
  for (const site of Object.values(scenario.states)) {
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
          culture: foreign ? "地方文化-" + site.id : site.ownerId,
          religion: foreign ? "地方信仰-" + site.id : site.ownerId,
          wealth: rank * rank * 4,
          literacy: 12 * rank + (hash(site.id) % 10),
          radicals: 0,
        });
      }
    }
    societies[site.id] = {
      pops,
      infrastructure: 1 + (hash(site.id) % 3),
      university: 0,
      construction: 1,
      barracks: 1,
      conscription: 1,
      arsenal: 1,
      ammunition: 1,
    };
  }
  for (const id of Object.keys(scenario.countries)) {
    nations[id] = {
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
export function literacyOf(pops: Pop[]) {
  const people = pops.reduce((n, p) => n + p.people, 0);
  return people ? pops.reduce((n, p) => n + p.people * p.literacy, 0) / people : 0;
}
export function influence(locals: SiteSocial[], id: string, nation: Nation) {
  const points = Object.fromEntries(groups.map((g) => [g, 0])) as Record<Group, number>;
  let sum = 0;
  for (const { pops } of locals)
    for (const pop of pops) {
      const weight =
        pop.people *
        (nation.laws.includes("普选制") ? 1 : Math.max(1, pop.wealth)) *
        (accepted(pop, id, nation) ? 1 : 0.05);
      points[socialTags[pop.occupation][1]] += weight;
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
};
export function approval(nation: Nation, g: Group) {
  return (
    (nation.government.includes(g) ? 8 : 0) +
    nation.laws.reduce((n, l) => n + (supporters[l].includes(g) ? 4 : -1), 0)
  );
}
export function reformConditions(nation: Nation, power: Record<Group, number>, law: Law) {
  const government = nation.government;
  const divisions =
    (government.includes("地主") && government.includes("工会") ? 16 : 0) +
    (government.includes("教会") && government.includes("知识分子") ? 16 : 0);
  const legitimacy = Math.max(
    0,
    Math.min(
      100,
      Math.round(25 + government.reduce((n, g) => n + power[g], 0) - divisions - 4 * (government.length - 1)),
    ),
  );
  const support = supporters[law].reduce((n, g) => n + power[g], 0);
  const backed = government.some((g) => supporters[law].includes(g)) || support >= 25;
  return { legitimacy, support, backed, speed: !backed || legitimacy < 25 ? 0 : legitimacy < 50 ? 0.5 : 1 };
}
export function evolvePops(
  site: SiteSocial,
  id: string,
  nation: Nation,
  growth: number,
  grainPrice: number,
  grainWages: number,
  clothWages: number,
  dividends: number,
  textileJobs: number,
) {
  const totals = Object.fromEntries(
    occupations.map((o) => [o, site.pops.reduce((s, p) => s + (p.occupation === o ? p.people : 0), 0)]),
  ) as Record<Occupation, number>;
  const birthWeight = (p: Pop) =>
    p.people * (growth >= 0 ? 1 + Math.min(p.wealth, 50) / 40 : 1 / (1 + p.wealth / 40));
  const weight = site.pops.reduce((s, p) => s + birthWeight(p), 0);
  let cumulative = 0,
    assigned = 0;
  const pops = site.pops.map((p, i) => {
    const isAccepted = accepted(p, id, nation);
    const income =
      p.occupation === "农民"
        ? grainWages
        : p.occupation === "劳工"
          ? clothWages
          : socialTags[p.occupation][0] === "上层"
            ? dividends / 2
            : totals[p.occupation] * 4;
    const living = Math.max(
      0.5,
      (((income / Math.max(1, totals[p.occupation])) * 0.3) / (grainPrice / 100)) * (isAccepted ? 1 : 0.65),
    );
    const wealth = Math.max(0.5, p.wealth * 0.96 + Math.min(150, living) * 0.04);
    const literacy = Math.min(
      100,
      p.literacy +
        0.006 * wealth +
        (nation.knowledge["高等教育"] === 100 ? 0.08 : 0.03) * site.university +
        (nation.knowledge["公共教育"] === 100 ? 0.12 : 0),
    );
    const radicals = Math.max(
      0,
      Math.min(
        100,
        p.radicals +
          (wealth < 4 + p.literacy / 12 + (nation.knowledge["公共教育"] === 100 ? 1 : 0) ? 0.25 : -0.18) +
          (isAccepted ? 0 : 0.12),
      ),
    );
    cumulative += birthWeight(p);
    const share = i === site.pops.length - 1 ? growth : Math.round((growth * cumulative) / weight);
    const change = share - assigned;
    assigned = share;
    return { ...p, wealth, literacy, radicals, people: p.people + change };
  });
  // Fill workshop vacancies from rural households of the same identity.
  const targetLabourers = Math.ceil(textileJobs / 0.4);
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
      Math.ceil((textileJobs * 0.12 * p.people) / Math.max(1, totals["劳工"])) - engineers.people,
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
