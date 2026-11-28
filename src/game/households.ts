import { z } from "zod";
import { industries } from "./industry.ts";
import type { ByGood, Good } from "./industry.ts";
import type { Pop } from "./society.ts";
import { emptyHouseholdIncome } from "./taxation.ts";
import type { HouseholdIncome } from "./taxation.ts";

export const startingLivingStandard = 10;

export const extraGoods = ["food", "dailyGoods", "services", "luxury"] as const;
type ExtraGood = typeof extraGoods[number];
const quantities = z.record(z.enum(extraGoods), z.int().nonnegative());
export const extrasReportSchema = z.object({
  budget: z.int().nonnegative(),
  orders: quantities,
  delivered: quantities,
  spending: z.int().nonnegative(),
}).refine(({ budget, spending, orders, delivered }) => spending <= budget &&
  extraGoods.every((good) => delivered[good] <= orders[good]));
export type ExtrasReport = z.infer<typeof extrasReportSchema>;

export const essentialGoods = ["grain", "cloth", "wood", "services"] as const;
const basicMarketGoods = ["grain", "food", "cloth", "wood", "coal", "services"] as const;
const grainPerFood = 2;
export const basicPurchasesSchema = z.object({
  budget: z.int().nonnegative(),
  spending: z.int().nonnegative(),
}).refine(({ budget, spending }) => spending <= budget);
export type BasicPurchases = z.infer<typeof basicPurchasesSchema>;
export const substituteOrdersSchema = z.object({ food: z.int().nonnegative(), coal: z.int().nonnegative() });
export type SubstituteOrders = z.infer<typeof substituteOrdersSchema>;

export function planBasicBasket(
  needs: ByGood<number>, supply: ByGood<number>, prices: ByGood<number>, coalForIndustry: number,
) {
  const food = supply.grain < needs.grain || prices.food <= prices.grain * grainPerFood
    ? Math.min(supply.food, Math.floor(needs.grain / (2 * grainPerFood))) : 0;
  const coal = supply.wood < needs.wood || prices.coal <= prices.wood
    ? Math.min(Math.max(0, supply.coal - coalForIndustry), Math.floor(needs.wood / 2)) : 0;
  return { ...needs, grain: needs.grain - grainPerFood * food, wood: needs.wood - coal, food, coal };
}

export function openingBasicBudget(population: number) {
  return essentialGoods.reduce((total, good) => total + Math.round(population * industries[good].demandPerPerson) *
    Math.ceil(industries[good].basePrice * 1.75), 0);
}

export function fundBasicBasket(
  orders: ByGood<number>, ceilings: ByGood<number>, basicBudget: number, discretionaryBudget: number,
) {
  const required = basicMarketGoods.reduce((sum, good) => sum + orders[good] * ceilings[good], 0);
  const redirected = Math.min(discretionaryBudget, Math.max(0, required - basicBudget));
  const budget = basicBudget + redirected;
  const funds = { basicBudget: budget, discretionaryBudget: discretionaryBudget - redirected };
  if (required <= budget) return { orders, ...funds };
  const funded = { ...orders };
  let remaining = budget;
  for (const good of basicMarketGoods) {
    funded[good] = Math.floor(orders[good] * budget / required);
    remaining -= funded[good] * ceilings[good];
  }
  for (const good of basicMarketGoods) {
    const extra = Math.min(orders[good] - funded[good], Math.floor(remaining / ceilings[good]));
    funded[good] += extra;
    remaining -= extra * ceilings[good];
  }
  return { orders: funded, ...funds };
}

export function basicEquivalentSupply(delivered: ByGood<number>, extra?: ExtrasReport["delivered"]) {
  return {
    grain: delivered.grain + (delivered.food - (extra?.food ?? 0)) * grainPerFood,
    cloth: delivered.cloth,
    wood: delivered.wood + delivered.coal,
    services: delivered.services - (extra?.services ?? 0),
  };
}

export function substitutedBasketCost(prices: ByGood<number>, orders: SubstituteOrders) {
  return orders.food * (prices.food - grainPerFood * prices.grain) + orders.coal * (prices.coal - prices.wood);
}

export function isExtraGood(good: Good): good is ExtraGood {
  return (extraGoods as readonly Good[]).includes(good);
}

export function byExtraGood<T>(make: (good: ExtraGood) => T): Record<ExtraGood, T> {
  return { food: make("food"), dailyGoods: make("dailyGoods"), services: make("services"), luxury: make("luxury") };
}

const preferences = { food: 0.25, dailyGoods: 0.35, services: 0.25, luxury: 0.15 };
const extraPerPerson = { food: 0.20, dailyGoods: 0.25, services: 0.25, luxury: 0.075 };
export function extrasOrders(people: number, budget: number, surcharge: (good: ExtraGood) => number = () => 0) {
  return byExtraGood((good) => {
    const ceiling = Math.ceil(industries[good].basePrice * 1.75);
    const grossPrice = Math.ceil(ceiling * (1 + surcharge(good)));
    return Math.min(Math.round(people * extraPerPerson[good]), Math.floor(budget * preferences[good] / grossPrice));
  });
}

type IncomeOccupation = keyof HouseholdIncome | "军人" | "军官";
export function allocateHouseholdIncome(
  pops: readonly Pop[], basicCost: number, income: Record<IncomeOccupation, number>, ruralEssentials: number,
) {
  const people = { ...emptyHouseholdIncome(), 军人: 0, 军官: 0 };
  for (const { occupation, people: size } of pops) if (Object.hasOwn(people, occupation))
    people[occupation as IncomeOccupation] += size;
  let basic = 0, discretionary = 0;
  for (const job of Object.keys(people) as IncomeOccupation[]) {
    if (people[job] === 0) continue;
    const required = Math.max(0, basicCost * people[job] - (job === "农民" ? ruralEssentials : 0));
    const reserved = Math.min(required, income[job]);
    basic += reserved;
    discretionary += income[job] - reserved;
  }
  return { basic: Math.floor(basic), discretionary: Math.floor(discretionary) };
}

export function livingStandardTarget(consumptionIndex: number, foodFulfillment: number) {
  const target = Math.max(1, Math.min(30, 10 + 4 * Math.log2(consumptionIndex)));
  return foodFulfillment < 0.8 ? Math.min(target, 1 + 11 * foodFulfillment) : target;
}

export function updateLivingStandard(current: number, target: number) {
  return current + 0.2 * (target - current);
}
