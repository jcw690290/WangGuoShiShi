import { GameRuleError } from "./rules.ts";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { groups, influence, literacyOf, reformConditions, reformWork, techs, unrestOf } from "./society.ts";
import type { Group, Law, Nation, SiteSocial, Tech } from "./society.ts";

export const textileResearch = { outputBonus: 25, weeks: 4 };
export const researchCategory = {
  纺织工艺: "生产",
  野战后勤: "军事",
  公共教育: "社会",
  机械织造: "生产",
  运输调度: "军事",
  高等教育: "社会",
} as const;
const categories = ["生产", "军事", "社会"] as const;
const prerequisite: Partial<Record<Tech, Tech>> = {
  机械织造: "纺织工艺",
  运输调度: "野战后勤",
  高等教育: "公共教育",
};
export function availableTech(n: Nation, t: Tech) {
  const prior = prerequisite[t];
  return n.knowledge[t] < 100 && (!prior || n.knowledge[prior] === 100);
}
export function researchCost(tech: Tech, year: number) {
  const advanced = prerequisite[tech] !== undefined;
  const referenceYear = advanced ? 1850 : 1820;
  const base = advanced ? 10_000 : 4_000;
  return Math.round(base * (1 + 0.02 * Math.max(0, referenceYear - year)));
}
export function researchCapacity(staff: number, literacy: number) {
  return { innovation: staff / 10, cap: 30 + 1.7 * literacy };
}
export const techEffect: Record<Tech, string> = {
  纺织工艺: "布匹产出 +25%",
  机械织造: "布匹产出再增加 15%",
  野战后勤: "有效战力 +25%",
  运输调度: "前线运输容量 +30%",
  公共教育: "有教育覆盖的州每月增加识字率",
  高等教育: "教育覆盖带来的识字率增益提高",
};
export const lawEffect: Record<Law, string> = {
  工资税改革: "工资税从 10% 提高至 14%",
  干预主义: "私人建造份额 50%，基础再投资比例 25%",
  自由放任: "私人建造份额 75%，基础再投资比例 40%",
  平等公民权: "接纳所有文化",
  信仰自由: "接纳所有信仰",
  普选制: "扩大基层参与，上／中／下层权重为 1.5／1.2／1",
  出版自由: "解除科技扩散的审查折减",
};
export type PoliticsCommand =
  | { type: "setGovernment"; countryId: string; government: Group[] }
  | { type: "proposeLaw"; countryId: string; law: Law }
  | { type: "startResearch"; countryId: string; tech: Tech };
export function ownedSocieties(state: GameState, id: string) {
  return Object.keys(state.societies)
    .filter((s) => state.ownerByStateId[s] === id)
    .map((s) => state.societies[s]);
}
export function politicsError(state: GameState, command: PoliticsCommand) {
  const id = command.countryId,
    nation = state.nations[id];
  if (!nation || state.playerCountryId === null) return "请先选择剧本内国家";
  if (command.type === "setGovernment") {
    if (
      !command.government.length ||
      new Set(command.government).size !== command.government.length ||
      !command.government.every((g) => groups.includes(g))
    )
      return "政府需要不重复的利益集团";
  } else if (command.type === "startResearch") {
    if (nation.research !== null || !availableTech(nation, command.tech))
      return "已有研究、缺少前置技术或已经掌握该技术";
  } else {
    if (nation.reform !== null || nation.laws.includes(command.law)) return "已有议案或该法已生效";
    const sites = ownedSocieties(state, id);
    const power = influence(sites, id, nation);
    if (!reformConditions(nation, power, command.law, unrestOf(sites.flatMap((site) => site.pops))).speed)
      return "需要政府集团或政治运动支持，并达到 25 合法性";
  }
}
export function applyPolitics(state: GameState, command: PoliticsCommand): GameState {
  const error = politicsError(state, command);
  if (error) throw new GameRuleError(error);
  const change =
    command.type === "setGovernment"
      ? { government: command.government }
      : command.type === "startResearch"
        ? { research: command.tech }
        : { reform: command.law, reformProgress: 0 };
  return {
    ...state,
    nations: { ...state.nations, [command.countryId]: { ...state.nations[command.countryId], ...change } },
  };
}
export function advancePolitics(state: GameState, report: EconomyReport, year: number, yearFraction: number): GameState {
  const known = techs.filter((t) => Object.values(state.nations).some((n) => n.knowledge[t] === 100));
  const nations: Record<string, Nation> = {};
  const locals: Record<string, SiteSocial[]> = Object.fromEntries(
    Object.keys(state.nations).map((id) => [id, []]),
  );
  const staff = Object.fromEntries(Object.keys(state.nations).map((id) => [id, 0]));
  for (const [id, site] of Object.entries(state.societies)) {
    const owner = state.ownerByStateId[id];
    locals[owner].push(site);
    staff[owner] += report.states[id].universityStaff!;
  }
  for (const [id, previous] of Object.entries(state.nations)) {
    const nation = {
      ...previous,
      knowledge: { ...previous.knowledge },
      diffusion: { ...previous.diffusion },
    };
    const sites = locals[id],
      people = sites.flatMap((s) => s.pops);
    if (people.length) {
      const literacy = literacyOf(people);
      const { innovation, cap } = researchCapacity(staff[id], literacy);
      const spreading = categories.map((category) => known.find((tech) =>
        researchCategory[tech] === category && availableTech(previous, tech),
      )).filter((tech) => tech !== undefined);
      const spillover = spreading.length > 0 ? Math.max(0, innovation - cap) * 0.5 / spreading.length : 0;
      for (const tech of techs) {
        const cost = researchCost(tech, year);
        const diffusion = spreading.includes(tech)
          ? (5 + 0.15 * literacy + spillover) * (nation.laws.includes("出版自由") ? 1 : 0.65) : 0;
        const active = nation.research === tech ? Math.min(innovation, cap) : 0;
        nation.diffusion[tech] = Math.min(100 - nation.knowledge[tech], 100 * diffusion / cost);
        nation.knowledge[tech] = Math.min(100, nation.knowledge[tech] + nation.diffusion[tech] + 100 * active / cost);
        if (nation.research === tech && nation.knowledge[tech] === 100) nation.research = null;
      }
      if (nation.reform) {
        nation.reformProgress += reformConditions(nation, influence(sites, id, nation), nation.reform, unrestOf(people)).speed;
        if (nation.reformProgress >= reformWork - 1e-9) {
          const reform = nation.reform;
          const retained = nation.laws.filter(
            (l) =>
              !(reform === "自由放任" && l === "干预主义") && !(reform === "干预主义" && l === "自由放任"),
          );
          nation.laws = [...retained, reform];
          nation.reform = null;
          nation.reformProgress = 0;
        }
      }
    }
    nation.infamy = Math.max(0, nation.infamy - 2 * yearFraction);
    nations[id] = nation;
  }
  return { ...state, nations };
}
export function getEconomicRules(nation: Nation) {
  return {
    wageTaxRate: nation.laws.includes("工资税改革") ? 14 : 10,
    clothOutputBonus:
      (nation.knowledge["纺织工艺"] === 100 ? 25 : 0) + (nation.knowledge["机械织造"] === 100 ? 15 : 0),
  };
}
