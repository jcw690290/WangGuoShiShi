import { useMemo, useRef } from "react";
import { silver } from "./format.ts";
import type { GameState } from "./game/engine.ts";
import { weeklyBudgets } from "./game/economy.ts";
import { fiscalRiskNames } from "./game/fiscal.ts";

export const governmentTabs = {
  country: "国家",
  economy: "经济与人口",
  politics: "政治与科技",
  diplomacy: "外交",
  military: "军事",
} as const;
export type GovernmentTab = keyof typeof governmentTabs;
export const governmentEntries = Object.entries(governmentTabs) as [GovernmentTab, string][];

export function MapGovernmentMenu({ open }: { open: (tab: GovernmentTab) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return <details className="map-government-menu" ref={menu}>
    <summary>政务</summary>
    <nav aria-label="地图政务入口">
      {governmentEntries.map(([tab, name]) => (
        <button key={tab} type="button" className="menu-button" aria-haspopup="dialog" onClick={() => {
          menu.current!.open = false;
          open(tab);
        }}>{name}</button>
      ))}
    </nav>
  </details>;
}

export function TreasuryStatus({ game, countryId, onInspect }: { game: GameState; countryId: string; onInspect: () => void }) {
  const { treasury, fiscal } = game.countryEconomies[countryId];
  const lastEconomy = game.lastEconomy;
  const budget = useMemo(() => lastEconomy ? weeklyBudgets(game.nations, lastEconomy)[countryId] : undefined,
    [countryId, game.nations, lastEconomy]);
  return <details className="treasury-status" onToggle={(event) => { if (event.currentTarget.open) onInspect(); }}>
    <summary>
      <span>国库 {silver(treasury)}</span>
      <span>{budget ? `周结余 ${silver(budget.balance)}` : "未结算"}</span>
      {fiscal && <span data-risk={fiscal.week.risk}>{fiscalRiskNames[fiscal.week.risk]}</span>}
    </summary>
    <div>
      <strong>财政信用</strong>
      {fiscal ? <dl>
        <dt>债务</dt><dd>{silver(fiscal.debt)}</dd>
        <dt>信用上限</dt><dd>{silver(fiscal.week.creditLimit)}</dd>
        <dt>未付利息</dt><dd>{silver(fiscal.arrears)}</dd>
        <dt>必要支出实付</dt><dd>{silver(fiscal.week.upkeepPaid)} / {silver(fiscal.week.upkeepDue)}</dd>
      </dl> : <p>尚无财政周结记录。</p>}
    </div>
  </details>;
}

export function DrawerGrip({ expanded, setExpanded }: { expanded: boolean; setExpanded: (value: boolean) => void }) {
  const drag = useRef<{ pointer: number; start: number } | null>(null);
  const swiped = useRef(false);
  return <button type="button" className="drawer-grip" aria-expanded={expanded}
    aria-label={expanded ? "收起政务抽屉" : "展开政务抽屉"}
    onPointerDown={(event) => {
      swiped.current = false;
      drag.current = { pointer: event.pointerId, start: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={(event) => {
      const initial = drag.current;
      drag.current = null;
      if (initial?.pointer !== event.pointerId) return;
      const distance = event.clientY - initial.start;
      if (Math.abs(distance) >= 24) {
        swiped.current = true;
        setExpanded(distance < 0);
      }
    }}
    onPointerCancel={() => { drag.current = null; }}
    onClick={(event) => {
      if (!swiped.current || event.detail === 0) setExpanded(!expanded);
      swiped.current = false;
    }}
  ><span aria-hidden="true" /></button>;
}
