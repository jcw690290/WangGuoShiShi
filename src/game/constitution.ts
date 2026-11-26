import { z } from "zod";
import { civicLawOf } from "./civic-policy.ts";
import type { GameState } from "./engine.ts";
import type { Group, Nation } from "./society.ts";

export const constitutionalForms = ["君主制", "共和制", "教权政体"] as const;
export const constitutionalFormSchema = z.enum(constitutionalForms);
export const representationLaws = ["专制统治", "有限选举", "普选制"] as const;
const distributions = { 专制统治: "autocracy", 有限选举: "limited", 普选制: "universal" } as const;
export const constitutionalLaws = [...constitutionalForms, ...representationLaws] as const;
export function constitutionLawCategory(law: string) {
  if ((constitutionalForms as readonly string[]).includes(law)) return "stateForm";
  if ((representationLaws as readonly string[]).includes(law)) return "representation";
}

export function startingStateForm(countryId: string): typeof constitutionalForms[number] {
  if (countryId === "country_08" || countryId === "country_12") return "共和制";
  if (countryId === "country_20") return "教权政体";
  return "君主制";
}

export const stateForm = (nation: Nation) =>
  constitutionalForms.find((law) => nation.laws.includes(law)) ?? nation.startingStateForm ?? "君主制";
export const representationLaw = (nation: Nation) =>
  representationLaws.find((law) => nation.laws.includes(law)) ?? (nation.startingRepresentation === "limited" ? "有限选举" : "专制统治");
export const powerDistribution = (nation: Nation) => distributions[representationLaw(nation)];

const mandateGroups: Record<typeof constitutionalForms[number], readonly Group[]> = {
  君主制: ["地主", "教会", "武装部队"],
  共和制: ["小市民", "实业家", "知识分子"],
  教权政体: ["教会", "地主"],
};
export const constitutionalMandate = (nation: Nation) => mandateGroups[stateForm(nation)];

const authorityByForm = { 君主制: 100, 共和制: 75, 教权政体: 110 };
const authorityByRepresentation = { autocracy: 20, limited: 0, universal: -20 };
export const localNegotiationAuthority = 25;
export function authorityBudget(state: GameState, countryId: string) {
  const nation = state.nations[countryId];
  const capacity = authorityByForm[stateForm(nation)] + authorityByRepresentation[powerDistribution(nation)] +
    (civicLawOf(nation.laws, "speech") === "出版审查" ? 10 : 0);
  const used = Object.entries(state.ownerByStateId).reduce((sum, [id, owner]) =>
    sum + (owner === countryId && state.societies[id].stability?.incident?.negotiated ? localNegotiationAuthority : 0), 0);
  return { used, capacity, available: Math.max(0, capacity - used) };
}

const regimeSuffix = { 君主制: "王国", 共和制: "共和国", 教权政体: "教权国" };
const specialStems: Partial<Record<string, string>> = {
  country_08: "美利坚", country_09: "俄罗斯", country_20: "罗马", country_29: "日本",
};
export function countryDisplayName(country: { id: string; name: string }, nation: Nation) {
  if (country.id.startsWith("civil_")) return country.name;
  const form = stateForm(nation);
  if (form === startingStateForm(country.id)) return country.name;
  const stem = specialStems[country.id] ?? country.name.replace(/(?:联合王国|联合共和国|帝国|王国|共和国|邦联|联邦|诸酋长国|王朝|帝政)$/, "");
  return stem + regimeSuffix[form];
}
