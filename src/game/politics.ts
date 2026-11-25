import { GameRuleError } from "./rules.ts";
import type { GameState } from "./engine.ts";
import type { EconomyReport } from "./economy.ts";
import { groups, influence, literacyOf, reformConditions, techs } from "./society.ts";
import type { Group, Law, Nation, SiteSocial, Tech } from "./society.ts";

export const wageTaxReform = { baseRate: 10, rate: 14, weeks: 2 };
export const textileResearch = { outputBonus: 25, weeks: 4 };
export const researchCategory = {
  纺织工艺: "生产",
  野战后勤: "军事",
  公共教育: "社会",
  机械织造: "生产",
  运输调度: "军事",
  高等教育: "社会",
};
const prerequisite: Partial<Record<Tech, Tech>> = {
  机械织造: "纺织工艺",
  运输调度: "野战后勤",
  高等教育: "公共教育",
};
export function availableTech(n: Nation, t: Tech) {
  const prior = prerequisite[t];
  return n.knowledge[t] < 100 && (!prior || n.knowledge[prior] === 100);
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
  普选制: "政治权力按人数计权",
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
    const power = influence(ownedSocieties(state, id), id, nation);
    if (!reformConditions(nation, power, command.law).speed)
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
export function advancePolitics(state: GameState, report: EconomyReport): GameState {
  const known = techs.filter((t) => Object.values(state.nations).some((n) => n.knowledge[t] === 100));
  const nations: Record<string, Nation> = {};
  const locals: Record<string, SiteSocial[]> = Object.fromEntries(
    Object.keys(state.nations).map((id) => [id, []]),
  );
  for (const [id, site] of Object.entries(state.societies)) locals[state.ownerByStateId[id]].push(site);
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
      const innovation = 24 + sites.reduce((s, v) => s + v.university * 4, 0);
      const cap = 12 + literacy * 0.48;
      for (const tech of techs) {
        const diffusion =
          known.includes(tech) && availableTech(previous, tech)
            ? (1.2 + literacy * 0.16 + Math.max(0, innovation - cap) * 0.4) *
              (nation.laws.includes("出版自由") ? 1 : 0.65)
            : 0;
        nation.diffusion[tech] = Math.min(100, diffusion);
        const gain = diffusion + (nation.research === tech ? Math.min(innovation, cap) : 0);
        nation.knowledge[tech] = Math.min(100, nation.knowledge[tech] + gain);
        if (nation.research === tech && nation.knowledge[tech] === 100) nation.research = null;
      }
      if (nation.reform) {
        nation.reformProgress += reformConditions(nation, influence(sites, id, nation), nation.reform).speed;
        if (nation.reformProgress >= wageTaxReform.weeks) {
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
    nation.infamy = Math.max(0, nation.infamy - 0.1);
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
