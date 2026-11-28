export const militaryServiceLaws = ["地方民兵", "职业常备军", "义务兵役"] as const;
type MilitaryServiceLaw = typeof militaryServiceLaws[number];
export const isMilitaryServiceLaw = (law: string): law is MilitaryServiceLaw =>
  (militaryServiceLaws as readonly string[]).includes(law);

export const militaryServicePolicies = {
  地方民兵: { regularsPerBarracks: 70, reservesPerCenter: 400, mobilizationDays: 42 },
  职业常备军: { regularsPerBarracks: 100, reservesPerCenter: 500, mobilizationDays: 28 },
  义务兵役: { regularsPerBarracks: 100, reservesPerCenter: 750, mobilizationDays: 21 },
};
export const militaryServiceLaw = (laws: readonly string[]) => laws.find(isMilitaryServiceLaw) ?? "职业常备军";
export const militaryServicePolicy = (laws: readonly string[]) => militaryServicePolicies[militaryServiceLaw(laws)];
