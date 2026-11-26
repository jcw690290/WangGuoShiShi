import type { Pop, SiteSocial } from "./society.ts";

export function cultureShares(pops: readonly Pop[]) {
  const shares = new Map<string, number>();
  let total = 0;
  for (const { culture, people } of pops) {
    if (people === 0) continue;
    shares.set(culture, (shares.get(culture) ?? 0) + people);
    total += people;
  }
  for (const [culture, people] of shares) shares.set(culture, people / total);
  return shares;
}

export function initialCulturalAffinity(pops: readonly Pop[]): Record<string, number> {
  return Object.fromEntries([...cultureShares(pops)].map(([culture, share]) => [culture, 50 + 50 * share]));
}

export function culturalAffinityOf(site: SiteSocial) {
  return site.culturalAffinity ?? initialCulturalAffinity(site.pops);
}

export function affinityLevel(affinity: number) {
  return affinity < 25 ? "陌生" : affinity < 50 ? "接触" : affinity < 75 ? "熟悉" : "亲近";
}

export function updateCulturalAffinity(
  previous: Record<string, number>,
  residents: ReadonlyMap<string, number>,
  neighbors: readonly ReadonlyMap<string, number>[],
  educationCoverage: number,
  tradeContacts: readonly { shares: ReadonlyMap<string, number>; strength: number }[],
): Record<string, number> {
  const contact = new Map(residents);
  for (const shares of neighbors) {
    for (const [culture, share] of shares) {
      const strength = 0.5 * share;
      contact.set(culture, Math.max(contact.get(culture) ?? 0, strength));
    }
  }
  for (const { shares, strength } of tradeContacts) {
    for (const [culture, share] of shares) {
      contact.set(culture, Math.min(1, (contact.get(culture) ?? 0) + share * strength));
    }
  }
  const affinity = new Map<string, number>();
  for (const culture of new Set([...Object.keys(previous), ...contact.keys()])) {
    const value = Object.hasOwn(previous, culture) ? previous[culture] : 0;
    const exposure = contact.get(culture);
    const next = exposure === undefined
      ? Math.max(0, value - 0.25)
      : Math.min(100, value + Math.min(1, (0.15 + 0.65 * exposure + 0.2 * educationCoverage) *
        (value > 70 ? (100 - value) / 30 : 1)));
    if (next > 0) affinity.set(culture, next);
  }
  return Object.fromEntries(affinity);
}
