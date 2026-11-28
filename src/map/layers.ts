import { count } from "../format.ts";
import type { GameState } from "../game/engine.ts";
import { cultureName, cultureShares } from "../game/culture.ts";
import { frontLine, planWar } from "../game/diplomacy.ts";
import { governanceOf, governanceRules } from "../game/governance.ts";
import { industries } from "../game/industry.ts";
import type { Scenario } from "../scenario/scenario.ts";
import { countryColor } from "./cartography.ts";

export const mapLayerNames = {
  owner: "政治归属",
  controller: "实际控制",
  culture: "人口文化",
  industry: "资源产业",
  market: "市场物流",
  governance: "地方治理",
  supply: "战争补给",
} as const;
export type MapLayer = keyof typeof mapLayerNames;
export type MapLayerCell = { color: string; text: string };

const noData = { color: "#c9c3b3", text: "暂无数据" };
const localCulture = { color: "#a67ca5", text: "地方文化" };
const resourceGroups = [
  { color: "#8eaf6d", text: "农业", goods: ["grain", "food", "fiber", "opium"] },
  { color: "#c69253", text: "原料", goods: ["wood", "iron", "coal", "oil", "rubber"] },
  { color: "#779ab2", text: "加工制造", goods: ["cloth", "tools", "paper", "dailyGoods", "luxury", "steel"] },
  { color: "#9e7ca2", text: "服务与重工业", goods: ["services", "arms", "ammo", "shipGoods", "electricity"] },
] as const;
const marketBands = [
  { color: "#6a9d88", text: "可达率至少 80%" },
  { color: "#d1ad68", text: "可达率 50–79%" },
  { color: "#bd7669", text: "可达率低于 50%" },
] as const;
const governanceColors = { PROVINCE: "#79a193", FRONTIER: "#b59b67", COLONIAL: "#b7806d", INDIRECT: "#9984ab" };
const supplyBands = {
  front: { color: "#c46558", text: "作战前线" },
  connected: { color: "#609696", text: "接通军需" },
  isolated: { color: "#c1a16f", text: "未接通军需" },
  neutral: { color: noData.color, text: "非参战地区" },
};

export const mapLayerLegends: Partial<Record<MapLayer, readonly MapLayerCell[]>> = {
  culture: [localCulture, noData],
  industry: [...resourceGroups, noData],
  market: [...marketBands, noData],
  governance: [...Object.entries(governanceColors).map(([mode, color]) => ({
    color, text: governanceRules[mode as keyof typeof governanceColors].name,
  })), noData],
  supply: Object.values(supplyBands),
};

export function mapLayerCells(scenario: Scenario, game: GameState, layer: MapLayer): Record<string, MapLayerCell> | undefined {
  if (layer === "owner" || layer === "controller") return;
  const tradeCounts = new Map<string, number>();
  if (layer === "market") for (const shipment of game.lastEconomy?.trade ?? []) {
    if (shipment.status !== "shipped") continue;
    for (const id of [shipment.from, shipment.to]) tradeCounts.set(id, (tradeCounts.get(id) ?? 0) + 1);
  }
  const war = layer === "supply" ? planWar(scenario, game) : undefined;
  const frontline = war ? new Set(frontLine(scenario, game, game.borderDispute!).map(({ id }) => id)) : undefined;
  if (war) for (const route of Object.values(war.routes)) frontline!.add(route.objective);
  const percent = (share: number) => Math.round(share * 100) + "%";

  return Object.fromEntries(Object.entries(scenario.states).map(([id, state]) => {
    const site = game.societies[id], local = game.stateEconomies[id], owner = game.ownerByStateId[id];
    const report = game.lastEconomy?.states[id];
    let cell: MapLayerCell = noData;
    if (layer === "culture" && site) {
      const dominant = [...cultureShares(site.pops)].sort((a, b) => b[1] - a[1])[0];
      if (dominant) {
        const [culture, share] = dominant;
        const country = scenario.countries[culture];
        cell = { color: country ? countryColor(country) : localCulture.color, text: `主要文化 ${cultureName(scenario, culture)} ${percent(share)}` };
      }
    } else if (layer === "industry") {
      const levels = local ? local.buildings : state.capacity;
      const group = resourceGroups.map((entry) => ({ ...entry, jobs: entry.goods.reduce((sum, good) =>
        sum + (levels[good] ?? 0) * industries[good].jobs, 0) })).sort((a, b) => b.jobs - a.jobs)[0];
      if (group.jobs > 0) cell = { color: group.color, text: `${local ? "主导产业" : "资源潜力"} ${group.text} · ${count(group.jobs)} 个基础岗位` };
    } else if (layer === "market" && report) {
      const access = report.access;
      const { color } = marketBands[access >= 0.8 ? 0 : access >= 0.5 ? 1 : 2];
      cell = { color, text: `最近周市场可达率 ${percent(access)} · 成交线路 ${tradeCounts.get(id) ?? 0} 条` };
    } else if (layer === "governance" && site) {
      const { mode, integrated } = governanceOf(site);
      const coverage = report?.office ? ` · 最近周行政覆盖 ${percent(report.office.coverage)}` : "";
      cell = { color: governanceColors[mode], text: `${governanceRules[mode].name} · ${integrated ? "已整合" : "待整合"}${coverage}` };
    } else if (layer === "supply") {
      const route = war?.routes[owner];
      const line = frontline?.has(id) || (route && !route.overseas && route.recruitmentStates.has(id));
      const status = line ? supplyBands.front : !route ? supplyBands.neutral :
        route.connectedStates.has(id) ? supplyBands.connected : supplyBands.isolated;
      const supply = game.lastEconomy?.countries[owner]?.military.supplyRatio;
      cell = { ...status, text: route && supply !== undefined ? `${status.text} · 本方最近周军需满足 ${percent(supply)}` : status.text };
    }
    return [id, cell];
  }));
}
