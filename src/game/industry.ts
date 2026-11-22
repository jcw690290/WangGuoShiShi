export const goods = ["grain", "cloth"] as const;
export type Good = typeof goods[number];
export type ByGood<T> = Record<Good, T>;

// Demo balance. Quantities are weekly and monetary values are in hundredths of a tael.
export const industries = {
  grain: { goodName: "粮食", name: "农田", jobs: 600, output: 6_000, demandPerPerson: 0.5,
    basePrice: 100, cost: 240_000, weeks: 2 },
  cloth: { goodName: "布匹", name: "纺织工坊", jobs: 400, output: 2_200, demandPerPerson: 0.16,
    basePrice: 200, cost: 360_000, weeks: 3 },
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
  return { grain: make("grain"), cloth: make("cloth") };
}
