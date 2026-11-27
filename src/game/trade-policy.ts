import { z } from "zod";
import { diplomaticTie } from "./diplomatic-ties.ts";
import type { GameState } from "./engine.ts";
import type { Nation } from "./society.ts";
import { GameRuleError } from "./rules.ts";
import { treatyBetween } from "./foreign-relations.ts";

export const tradeLaws = ["贸易保护", "自由贸易", "许可贸易"] as const;
export const isTradeLaw = (law: string) => (tradeLaws as readonly string[]).includes(law);
export const tradeLaw = (laws: readonly string[]) => tradeLaws.find((law) => laws.includes(law)) ?? tradeLaws[0];

export const tariffBands = ["low", "standard", "high"] as const;
export const tariffBandSchema = z.enum(tariffBands);
export const tariffBandNames = { low: "低", standard: "中", high: "高" };
export const tariffRates = { low: 5, standard: 10, high: 20 };
export const tariffRate = (nation: Nation) => tradeLaw(nation.laws) === "自由贸易" ? 0 : tariffRates[nation.tariffBand];
export const tradePartnersSchema = z.array(z.string()).refine((ids) => new Set(ids).size === ids.length);

export type TradePolicyCommand =
  | { type: "setTariffBand"; countryId: string; band: Nation["tariffBand"] }
  | { type: "setTradePartner"; countryId: string; partnerId: string; allowed: boolean };

export function applyTradePolicy(state: GameState, cmd: TradePolicyCommand): GameState {
  const nation = state.nations[cmd.countryId];
  if (!nation) throw new GameRuleError("无法设置陌生国家的贸易政策");
  if (cmd.type === "setTariffBand") {
    if (!tariffBandSchema.safeParse(cmd.band).success) throw new GameRuleError("关税档位无效");
    return { ...state, nations: { ...state.nations, [cmd.countryId]: { ...nation, tariffBand: cmd.band } } };
  }
  if (cmd.countryId === cmd.partnerId || !Object.hasOwn(state.nations, cmd.partnerId))
    throw new GameRuleError("请选择剧本内的外国贸易对象");
  const partners = new Set(nation.tradePartners);
  if (cmd.allowed) partners.add(cmd.partnerId);
  else partners.delete(cmd.partnerId);
  return { ...state, nations: { ...state.nations, [cmd.countryId]: { ...nation, tradePartners: [...partners] } } };
}

export function tradeRestriction(state: GameState, exporter: string, importer: string) {
  const allows = (country: string, partner: string) => {
    const nation = state.nations[country];
    return tradeLaw(nation.laws) !== "许可贸易" || nation.tradePartners.includes(partner) ||
      treatyBetween(state, country, partner, "commercial") !== undefined ||
      diplomaticTie(state, country, partner)?.kind === "tributeTrade";
  };
  if (!allows(exporter, importer)) return "exportPolicy";
  if (!allows(importer, exporter)) return "importPolicy";
}
