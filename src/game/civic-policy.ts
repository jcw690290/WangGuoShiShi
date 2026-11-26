import { culturalAffinityOf } from "./culture.ts";
import type { Pop, SiteSocial } from "./society.ts";

export const civicLawFamilies = {
  citizenship: { name: "公民权", options: ["本族公民权", "有限公民权", "平等公民权"] },
  religion: { name: "宗教", options: ["国教优先", "宗教宽容", "信仰自由"] },
  speech: { name: "言论", options: ["出版审查", "有限出版", "出版自由"] },
} as const;
type CivicFamily = keyof typeof civicLawFamilies;
const categories = Object.keys(civicLawFamilies) as CivicFamily[];
export const civicLaws = categories.flatMap((key) => [...civicLawFamilies[key].options]);
const civicCategories = new Map<string, CivicFamily>(categories.flatMap((key) =>
  civicLawFamilies[key].options.map((law) => [law, key] as const)));
export const civicLawCategory = (law: string) => civicCategories.get(law);
export const civicLawOf = (laws: readonly string[], family: CivicFamily) =>
  civicLawFamilies[family].options.find((law) => laws.includes(law)) ?? civicLawFamilies[family].options[0];
export const enactedCivicLaws = (laws: readonly string[]) => categories.map((key) => civicLawOf(laws, key));
const baselineCivicLaws = new Set<string>(categories.map((key) => civicLawFamilies[key].options[0]));
export const isBaselineCivicLaw = (law: string) => baselineCivicLaws.has(law);

export function civicPolicy(laws: readonly string[]) {
  const citizenship = civicLawOf(laws, "citizenship");
  const religion = civicLawOf(laws, "religion");
  const speech = civicLawOf(laws, "speech");
  return {
    citizenship, religion,
    diffusion: speech === "出版自由" ? 1 : speech === "有限出版" ? 0.85 : 0.65,
    organization: speech === "出版自由" ? 1.20 : speech === "有限出版" ? 1.10 : 1,
  };
}

export function civicStanding(pop: Pop, countryId: string, site: SiteSocial, policy: ReturnType<typeof civicPolicy>) {
  const affinity = policy.citizenship === "有限公民权" ? culturalAffinityOf(site)[pop.culture] ?? 0 : 0;
  const culture = pop.culture === countryId || policy.citizenship === "平等公民权" || affinity >= 50 ? 1 :
    policy.citizenship === "有限公民权" ? 0.5 : 0;
  const faith = pop.religion === countryId || policy.religion === "信仰自由" ? 1 :
    policy.religion === "宗教宽容" ? 0.5 : 0;
  return Math.min(culture, faith);
}
