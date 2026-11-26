export const originalGoods = ["grain", "cloth"] as const;
export const industrialGoods = ["wood", "iron", "coal", "tools", "paper", "services", "food", "fiber", "dailyGoods", "luxury", "steel", "arms", "ammo", "shipGoods", "electricity", "oil", "rubber", "opium"] as const;
export const goods = [...originalGoods, ...industrialGoods] as const;
export function isLocalGood(good: Good) {
  return good === "services" || good === "electricity";
}
export const tradableGoods = goods.filter((good) => !isLocalGood(good));
export type Good = typeof goods[number];
export type IndustrialGood = typeof industrialGoods[number];
export type ByGood<T> = Record<Good, T>;
export type ByIndustrialGood<T> = Record<IndustrialGood, T>;
export type ScenarioLevels = Record<typeof originalGoods[number], number> & Partial<ByIndustrialGood<number>>;

export const commercialLevels = { grain: 12, cloth: 4 } as const;
export const legacyCommercialCost = { grain: 240_000, cloth: 360_000 } as const;
export function convertCommercialLevels<T extends ScenarioLevels>(levels: T) {
  return { ...levels, grain: levels.grain * commercialLevels.grain, cloth: levels.cloth * commercialLevels.cloth };
}

export function isGood(value: string): value is Good {
  return (goods as readonly string[]).includes(value);
}

export function isIndustrialGood(value: Good): value is IndustrialGood {
  return (industrialGoods as readonly Good[]).includes(value);
}

// Quantities are weekly. Game price units are worth ten hundredths of a tael.
export const industries = {
  grain: { goodName: "粮食", name: "粮食农场", jobs: 100, output: 180, demandPerPerson: 0.20,
    basePrice: 100, cost: 80_000, weeks: 2 },
  cloth: { goodName: "布匹", name: "纺织厂", jobs: 100, output: 100, demandPerPerson: 0.02,
    basePrice: 300, cost: 160_000, weeks: 3 },
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
  food: { goodName: "副食品", name: "副食品生产", jobs: 100, output: 70, demandPerPerson: 0,
    basePrice: 200, cost: 130_000, weeks: 3 },
  fiber: { goodName: "纤维", name: "纤维种植", jobs: 100, output: 100, demandPerPerson: 0,
    basePrice: 200, cost: 130_000, weeks: 3 },
  dailyGoods: { goodName: "日用品", name: "日用品工场", jobs: 100, output: 70, demandPerPerson: 0,
    basePrice: 400, cost: 230_000, weeks: 5 },
  luxury: { goodName: "奢侈品", name: "奢侈品工场", jobs: 100, output: 50, demandPerPerson: 0,
    basePrice: 800, cost: 290_000, weeks: 5 },
  steel: { goodName: "钢材", name: "钢铁厂", jobs: 100, output: 60, demandPerPerson: 0,
    basePrice: 600, cost: 240_000, weeks: 5 },
  arms: { goodName: "武器", name: "兵工厂", jobs: 100, output: 45, demandPerPerson: 0,
    basePrice: 800, cost: 280_000, weeks: 3 },
  ammo: { goodName: "弹药", name: "弹药厂", jobs: 100, output: 60, demandPerPerson: 0,
    basePrice: 500, cost: 220_000, weeks: 3 },
  shipGoods: { goodName: "船舶制品", name: "造船厂", jobs: 100, output: 40, demandPerPerson: 0,
    basePrice: 1000, cost: 320_000, weeks: 5 },
  electricity: { goodName: "电力", name: "发电设施", jobs: 100, output: 120, demandPerPerson: 0,
    basePrice: 250, cost: 350_000, weeks: 5 },
  oil: { goodName: "石油", name: "油田", jobs: 100, output: 80, demandPerPerson: 0,
    basePrice: 300, cost: 260_000, weeks: 4 },
  rubber: { goodName: "橡胶", name: "橡胶园", jobs: 100, output: 100, demandPerPerson: 0,
    basePrice: 250, cost: 150_000, weeks: 3 },
  opium: { goodName: "鸦片", name: "鸦片产业", jobs: 100, output: 40, demandPerPerson: 0,
    basePrice: 600, cost: 170_000, weeks: 3 },
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
    food: make("food"), fiber: make("fiber"), dailyGoods: make("dailyGoods"), luxury: make("luxury"),
    steel: make("steel"), arms: make("arms"), ammo: make("ammo"), shipGoods: make("shipGoods"), electricity: make("electricity"),
    oil: make("oil"), rubber: make("rubber"), opium: make("opium"),
  };
}
