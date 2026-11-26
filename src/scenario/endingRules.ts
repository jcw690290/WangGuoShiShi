export const endingMetrics = [
  "G", "SOL", "LIT", "TUR", "CORE", "FISCAL_RUIN", "LEG", "TRADE", "SEA", "GOV", "SUP", "IND", "U",
  "ARM", "PUP", "NEWCUL", "FISCAL_RATIO", "DISCRIMINATION", "FOOD", "AGGRESSION_FREE_20",
  "ABOLISHED_SLAVERY", "ABOLISHED_SERFDOM", "TRAINING", "COERCED_LABOR", "IDENTITY_SERVITUDE_REFORM",
  "BASIC_CONSUMPTION", "SUSTAINABLE_FISCAL",
] as const;
type Metric = (typeof endingMetrics)[number];
export type EndingMetrics = Partial<Record<Metric, number>>;
type Condition = readonly [metric: Metric, comparison: ">=" | "<=" | ">" | "<", threshold: number];
interface NationalEndingRules {
  victory: readonly Condition[];
  defeat: readonly (readonly Condition[])[];
}

export const endingRules: Partial<Record<string, NationalEndingRules>> = {
  country_01: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 15], ["LIT", ">=", 50], ["TUR", "<=", 15], ["CORE", ">=", 0.9]],
    defeat: [[["CORE", "<", 0.5], ["TUR", ">", 55]], [["FISCAL_RUIN", ">=", 1], ["LEG", "<", 25]]],
  },
  country_02: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 17], ["TRADE", ">=", 0.5], ["SEA", ">=", 0.95]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["TUR", ">", 45]]],
  },
  country_03: {
    victory: [["CORE", ">=", 0.9], ["GOV", ">=", 0.85], ["SOL", ">=", 14], ["LIT", ">=", 45], ["SUP", ">=", 0.9]],
    defeat: [[["GOV", "<", 0.45], ["LEG", "<", 25], ["TUR", ">", 50]]],
  },
  country_04: {
    victory: [["G", ">=", 2], ["SOL", ">=", 17], ["LIT", ">=", 65], ["LEG", ">=", 60]],
    defeat: [[["TUR", ">", 60], ["LEG", "<", 25]]],
  },
  country_05: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 15], ["GOV", ">=", 0.85], ["TUR", "<=", 20]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["G", "<", 0.8]]],
  },
  country_06: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 15], ["TRADE", ">=", 0.35], ["GOV", ">=", 0.8]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["SEA", "<", 0.6]]],
  },
  country_07: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 17], ["TRADE", ">=", 0.5], ["IND", ">=", 0.25]],
    defeat: [[["G", "<", 0.65], ["U", ">", 0.25]]],
  },
  country_08: {
    victory: [["SOL", ">=", 17], ["LIT", ">=", 70], ["IND", ">=", 0.25], ["ABOLISHED_SLAVERY", ">=", 1], ["TUR", "<=", 20]],
    defeat: [[["CORE", "<", 0.6]], [["TUR", ">", 60], ["LEG", "<", 25]]],
  },
  country_09: {
    victory: [["G", ">=", 2], ["SOL", ">=", 15], ["LIT", ">=", 55], ["ABOLISHED_SERFDOM", ">=", 1]],
    defeat: [[["SOL", "<", 7], ["GOV", "<", 0.4], ["TUR", ">", 50]]],
  },
  country_10: {
    victory: [["IND", ">=", 0.35], ["LIT", ">=", 70], ["SOL", ">=", 16], ["TRAINING", ">=", 0.8]],
    defeat: [[["ARM", "<", 0.3], ["CORE", "<", 0.6]]],
  },
  country_11: {
    victory: [["SOL", ">=", 15], ["LIT", ">=", 55], ["CORE", ">=", 0.9], ["TUR", "<=", 15], ["DISCRIMINATION", "<=", 0.1]],
    defeat: [[["TUR", ">", 60], ["LEG", "<", 25]]],
  },
  country_12: {
    victory: [["SOL", ">=", 18], ["LIT", ">=", 80], ["TUR", "<=", 10], ["PUP", "<", 1], ["AGGRESSION_FREE_20", ">=", 1]],
    defeat: [[["PUP", ">=", 1]], [["CORE", "<", 0.5]]],
  },
  country_13: {
    victory: [["G", ">=", 2], ["SOL", ">=", 16], ["LIT", ">=", 65], ["FISCAL_RATIO", "<", 0.6]],
    defeat: [[["G", "<", 0.65], ["TUR", ">", 50]]],
  },
  country_14: {
    victory: [["SOL", ">=", 16], ["LIT", ">=", 65], ["TRADE", ">=", 0.4], ["PUP", "<", 1]],
    defeat: [[["PUP", ">=", 1]], [["CORE", "<", 0.5], ["LEG", "<", 30]]],
  },
  country_15: {
    victory: [["SOL", ">=", 16], ["GOV", ">=", 0.85], ["SEA", ">=", 0.95], ["TUR", "<=", 15]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["TUR", ">", 55]]],
  },
  country_16: {
    victory: [["G", ">=", 2], ["SOL", ">=", 17], ["LIT", ">=", 70]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["G", "<", 0.8]]],
  },
  country_18: {
    victory: [["G", ">=", 2], ["SOL", ">=", 16], ["IND", ">=", 0.3], ["LEG", ">=", 60]],
    defeat: [[["CORE", "<", 0.5]], [["FISCAL_RUIN", ">=", 1], ["LEG", "<", 25]]],
  },
  country_19: {
    victory: [["G", ">=", 2], ["SOL", ">=", 15], ["LIT", ">=", 55], ["GOV", ">=", 0.85]],
    defeat: [[["TUR", ">", 60], ["GOV", "<", 0.45]]],
  },
  country_20: {
    victory: [["SOL", ">=", 16], ["LIT", ">=", 60], ["LEG", ">=", 65], ["NEWCUL", ">=", 3]],
    defeat: [[["FISCAL_RUIN", ">=", 1]], [["CORE", "<", 0.5]]],
  },
  country_21: {
    victory: [["SOL", ">=", 16], ["LIT", ">=", 65], ["TRADE", ">=", 0.35], ["PUP", "<", 1]],
    defeat: [[["PUP", ">=", 1]], [["FISCAL_RUIN", ">=", 1]]],
  },
  country_22: {
    victory: [["G", ">=", 2], ["SOL", ">=", 15], ["LIT", ">=", 55], ["GOV", ">=", 0.85]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["TUR", ">", 50]]],
  },
  country_24: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 15], ["LIT", ">=", 55], ["COERCED_LABOR", "<=", 0.1]],
    defeat: [[["CORE", "<", 0.5]], [["FOOD", "<", 0.65], ["TUR", ">", 50]]],
  },
  country_25: {
    victory: [["G", ">=", 2], ["SOL", ">=", 16], ["LIT", ">=", 60], ["COERCED_LABOR", "<=", 0.1]],
    defeat: [[["GOV", "<", 0.4], ["TUR", ">", 60]]],
  },
  country_26: {
    victory: [["G", ">=", 1.8], ["SOL", ">=", 15], ["LIT", ">=", 55], ["GOV", ">=", 0.85]],
    defeat: [[["PUP", ">=", 1]], [["CORE", "<", 0.5]]],
  },
  country_28: {
    victory: [["SOL", ">=", 16], ["LIT", ">=", 65], ["GOV", ">=", 0.85], ["U", "<=", 0.08]],
    defeat: [[["SOL", "<", 7], ["TUR", ">", 60]], [["PUP", ">=", 1]]],
  },
  country_29: {
    victory: [["SOL", ">=", 17], ["LIT", ">=", 75], ["IND", ">=", 0.35], ["IDENTITY_SERVITUDE_REFORM", ">=", 1]],
    defeat: [[["FISCAL_RUIN", ">=", 1], ["TUR", ">", 55]], [["CORE", "<", 0.5]]],
  },
};

const generalVictory: readonly Condition[] = [
  ["SOL", ">=", 18], ["LIT", ">=", 75], ["TUR", "<=", 10], ["BASIC_CONSUMPTION", ">=", 0.95], ["SUSTAINABLE_FISCAL", ">=", 1],
];

function meets(conditions: readonly Condition[], metrics: EndingMetrics) {
  return conditions.every(([key, comparison, threshold]) => {
    const value = metrics[key];
    if (value === undefined) return false;
    switch (comparison) {
      case ">=": return value >= threshold;
      case "<=": return value <= threshold;
      case ">": return value > threshold;
      case "<": return value < threshold;
    }
  });
}

export function outcomeCandidates(countryId: string, metrics: EndingMetrics) {
  const rules = endingRules[countryId];
  return {
    defeat: rules?.defeat.some((conditions) => meets(conditions, metrics)) ?? false,
    victory: !!rules && meets(rules.victory, metrics),
    genericVictory: meets(generalVictory, metrics),
  };
}
