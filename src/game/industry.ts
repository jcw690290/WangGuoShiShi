export const originalGoods = ["grain", "cloth"] as const;
export const industrialGoods = ["wood", "iron", "coal", "tools", "paper", "services"] as const;
export const goods = [...originalGoods, ...industrialGoods] as const;
export const tradableGoods = goods.filter((good) => good !== "services");
export type Good = typeof goods[number];
export type IndustrialGood = typeof industrialGoods[number];
export type ByGood<T> = Record<Good, T>;
export type ByIndustrialGood<T> = Record<IndustrialGood, T>;
export type ScenarioLevels = Record<typeof originalGoods[number], number> & Partial<ByIndustrialGood<number>>;

export function isGood(value: string): value is Good {
  return (goods as readonly string[]).includes(value);
}

export function isIndustrialGood(value: Good): value is IndustrialGood {
  return (industrialGoods as readonly Good[]).includes(value);
}

// Quantities are weekly. Game price units are worth ten hundredths of a tael.
export const industries = {
  grain: { goodName: "粮食", name: "农田", jobs: 600, output: 6_000, demandPerPerson: 0.20,
    basePrice: 100, cost: 240_000, weeks: 2 },
  cloth: { goodName: "布匹", name: "纺织工坊", jobs: 400, output: 2_200, demandPerPerson: 0.02,
    basePrice: 300, cost: 360_000, weeks: 3 },
  wood: { goodName: "木材", name: "伐木场", jobs: 100, output: 100, demandPerPerson: 0.02,
    basePrice: 200, cost: 120_000, weeks: 3 },
  iron: { goodName: "铁", name: "铁矿", jobs: 100, output: 80, demandPerPerson: 0,
    basePrice: 300, cost: 170_000, weeks: 4 },
  coal: { goodName: "煤", name: "煤矿", jobs: 100, output: 100, demandPerPerson: 0,
    basePrice: 200, cost: 150_000, weeks: 4 },
  tools: { goodName: "工具", name: "工具厂", jobs: 100, output: 80, demandPerPerson: 0,
    basePrice: 400, cost: 220_000, weeks: 5 },
  paper: { goodName: "纸张", name: "造纸厂", jobs: 100, output: 100, demandPerPerson: 0,
    basePrice: 250, cost: 240_000, weeks: 5 },
  services: { goodName: "服务", name: "服务业", jobs: 100, output: 100, demandPerPerson: 0.01,
    basePrice: 200, cost: 150_000, weeks: 4 },
} satisfies ByGood<{
  goodName: string;
  name: string;
  jobs: number;
  output: number;
  demandPerPerson: number;
  basePrice: number;
  cost: number;
  weeks: number;
}>;

export function byGood<T>(make: (good: Good) => T): ByGood<T> {
  return { grain: make("grain"), cloth: make("cloth"), ...byIndustrialGood(make) };
}

export function byIndustrialGood<T>(make: (good: IndustrialGood) => T): ByIndustrialGood<T> {
  return {
    wood: make("wood"), iron: make("iron"), coal: make("coal"), tools: make("tools"),
    paper: make("paper"), services: make("services"),
  };
}
