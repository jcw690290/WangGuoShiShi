import { useMemo, useState } from "react";
import {
  attacking,
  canAddGoal,
  canDemandGoal,
  canReach,
  frontLine,
  goalNames,
  goals,
  holdings,
  interested,
  participants,
} from "./game/diplomacy.ts";
import type { BorderCommand, Goal } from "./game/diplomacy.ts";
import type { EconomyReport } from "./game/economy.ts";
import type { GameCommand, GameState } from "./game/engine.ts";
import type { Scenario } from "./scenario/scenario.ts";
interface Props {
  scenario: Scenario;
  game: GameState;
  playerId: string;
  report: EconomyReport;
  busy: boolean;
  send: (cmd: GameCommand) => void;
  selectedId: string | null;
}
const phases = {
  escalation: "提出要求",
  bargaining: "外交博弈",
  countdown: "开战倒计时",
  war: "战争",
  resolved: "已结束",
};
export function DiplomacyPanel({ scenario, game, playerId: id, report, busy, send, selectedId }: Props) {
  const n = game.nations[id],
    d = game.borderDispute,
    countries = scenario.countries;
  const [choice, setChoice] = useState(""),
    [goal, setGoal] = useState<Goal>("cession");
  const sites = useMemo(() => {
    const hasPort = holdings(scenario, game, id).some((s) => s.coastal);
    return Object.values(scenario.states).filter((s) => canReach(scenario, game, id, s.id, hasPort));
  }, [scenario, game.ownerByStateId, game.nations, id]);
  const target = sites.find((s) => s.id === choice) ?? sites.find((s) => s.id === selectedId) ?? sites[0];
  const [union, setUnion] = useState(""),
    [ally, setAlly] = useState("");
  const live = Object.keys(countries).filter((x) => Object.values(game.ownerByStateId).includes(x));
  const leaders = live.filter((x) => x !== id && !game.nations[x].marketLeader);
  const leader = leaders.includes(union) ? union : leaders[0];
  const involved = d && participants(d).includes(id),
    claimant = d?.claimantId === id,
    primary = claimant || d?.defenderId === id;
  const allies = d
    ? live.filter(
        (x) =>
          !participants(d).includes(x) &&
          !game.nations[x].overlord &&
          interested(scenario, game, x, d.targetStateId),
      )
    : [];
  const partner = allies.includes(ally) ? ally : allies[0];
  const btn = (name: string, cmd: BorderCommand, disabled = false) => (
    <button key={name} className="build" disabled={busy || disabled} onClick={() => send(cmd)}>
      {name}
    </button>
  );
  const simple = (
    type:
      | "backDown"
      | "orderAdvance"
      | "orderDefend"
      | "mobilize"
      | "raid"
      | "signTreaty"
      | "armistice"
      | "leaveUnion",
  ) => ({ type, countryId: id });
  const unionDisabled =
    Object.values(game.nations).some((v) => v.marketLeader === id) ||
    !!(d && d.phase !== "resolved" && involved);
  return (
    <section className="economy">
      <header className="economy-heading">
        <h2 id="diplomacy-title">外交与战争</h2>
        <span>
          恶名 {n.infamy.toFixed(1)}
          {n.infamy > 100 ? " · 国际弃民" : ""} · 外交信誉 {n.prestige}
        </span>
      </header>
      <div className="economy-grid">
        <section className="panel">
          <header className="panel-header">
            <h3>外交博弈</h3>
            {d && <span>{phases[d.phase]}</span>}
          </header>
          <div className="control-block">
            {d && (
              <p role="status">
                {countries[d.claimantId].name} → {countries[d.defenderId].name} ·{" "}
                {scenario.states[d.targetStateId].name} · {d.goals.map((g) => goalNames[g]).join("、")}
                {d.phase === "resolved" &&
                  " · " +
                    (d.outcome === "victory"
                      ? "已执行全部要求"
                      : d.outcome === "withdrawal"
                        ? "提出方撤回"
                        : "维持现状")}
              </p>
            )}
            {(!d || d.phase === "resolved") &&
              (target ? (
                <>
                  <label>
                    目标州
                    <select
                      aria-label="外交目标州"
                      value={target.id}
                      onChange={(e) => setChoice(e.target.value)}
                    >
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} · {countries[game.ownerByStateId[s.id]].name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    外交要求
                    <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>
                      {goals.map((g) => (
                        <option key={g} value={g}>
                          {goalNames[g]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {interested(scenario, game, id, target.id)
                    ? btn(
                        "提出外交要求",
                        { type: "demandBorder", countryId: id, targetStateId: target.id, goal },
                        !!n.overlord || !canDemandGoal(game, id, game.ownerByStateId[target.id], goal),
                      )
                    : btn("声明沿海利益", {
                        type: "declareInterest",
                        countryId: id,
                        targetStateId: target.id,
                      })}
                </>
              ) : (
                <p>当前没有可接触的外国州。</p>
              ))}
            {d && d.phase !== "resolved" && d.phase !== "war" && (
              <>
                <p>
                  本阶段已过 {game.elapsedDays - d.since} 天。提出要求 7 天，博弈 14 天，倒计时陆上 7 天、跨海
                  35 天。
                </p>
                {d.phase === "bargaining" && claimant && (
                  <>
                    <p>剩余博弈点 {d.maneuvers}</p>
                    {goals
                      .filter((g) => canAddGoal(game, d, g))
                      .map((g) =>
                        btn("追加" + goalNames[g], { type: "addGoal", countryId: id, goal: g }, !d.maneuvers),
                      )}
                    {partner && (
                      <>
                        <select
                          aria-label="拉拢国家"
                          value={partner}
                          onChange={(e) => setAlly(e.target.value)}
                        >
                          {allies.map((x) => (
                            <option key={x} value={x}>
                              {countries[x].name}
                            </option>
                          ))}
                        </select>
                        {btn(
                          "承诺战胜后支付 500 两并拉拢",
                          { type: "sway", countryId: id, allyId: partner },
                          !d.maneuvers,
                        )}
                      </>
                    )}
                  </>
                )}
                {primary && btn(claimant ? "撤回要求" : "让步并接受全部要求", simple("backDown"))}
              </>
            )}
            {d?.phase === "war" && (
              <>
                <p>
                  当前战线{" "}
                  {frontLine(scenario, game, d)
                    .map((s) => s.name)
                    .join("、")}{" "}
                  · {frontLine(scenario, game, d)[0].terrain ?? "平原"} · 战线进度 {d.progress}% · 割让门槛{" "}
                  {scenario.borderDispute.cessionProgress}%
                </p>
                <progress aria-label="战线进度" max={100} value={d.progress} />
                {participants(d).map((x) => {
                  const m = report.countries[x].military;
                  return (
                    <p key={x}>
                      {countries[x].name} · {attacking(d, x) ? "提出方" : "防守方"} ·{" "}
                      {d.advance.includes(x) ? "推进" : "防御"} · 全国常备 {m.regulars} · 征兵 {m.conscripts} ·
                      全军军粮 {m.grainDrawn} / {m.grainDemand} · 武器 {m.equipment.weapons.delivered}/
                      {m.equipment.weapons.demand}· 弹药 {m.equipment.ammunition.delivered}/
                      {m.equipment.ammunition.demand} · 军服 {m.equipment.uniforms.delivered}/
                      {m.equipment.uniforms.demand} · 前线战备 {Math.round(m.readiness * 100)}% · 士气 {game.nations[x].morale.toFixed(0)}%
                    </p>
                  );
                })}
                {involved && (
                  <div className="diplomacy-actions">
                    {btn("激活征兵", simple("mobilize"), d.mobilized.includes(id))}
                    {btn("命令推进", simple("orderAdvance"), d.advance.includes(id))}
                    {btn("命令防御", simple("orderDefend"), !d.advance.includes(id))}
                    {btn(
                      "舰队破交",
                      simple("raid"),
                      d.raid.includes(id) || !holdings(scenario, game, id).some((s) => s.coastal),
                    )}
                    {primary &&
                      btn(
                        "执行战争目标",
                        simple("signTreaty"),
                        d.lastChange === null || d.progress < scenario.borderDispute.cessionProgress,
                      )}
                    {primary && btn("维持现状停战", simple("armistice"), d.lastChange === null)}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        <section className="panel">
          <header className="panel-header">
            <h3>关税同盟与附属关系</h3>
          </header>
          <div className="control-block">
            <p>当前市场 · {countries[n.marketLeader ?? id].name}</p>
            <p>
              宗主国 · {n.overlord ? countries[n.overlord].name : "独立"} · 运输船队 {n.convoys}
            </p>
            <p>
              将领 {n.generalRank} 级 · 指挥上限 {n.generalRank * 300} 人
            </p>
            {btn(
              "晋升将领 · 800 两",
              { type: "promoteGeneral", countryId: id },
              n.generalRank >= 5 || game.countryEconomies[id].treasury < 80000,
            )}
            <p>
              关税同盟共享商品价格。保护国、傀儡和封臣分别按周缴纳 10%、15% 和 20%
              的税收。宗主国保护附属国，傀儡和封臣随宗主国参战。
            </p>
            {n.marketLeader
              ? btn("退出关税同盟", simple("leaveUnion"), !!n.overlord)
              : leader && (
                  <>
                    <select
                      aria-label="关税同盟领袖"
                      value={leader}
                      onChange={(e) => setUnion(e.target.value)}
                    >
                      {leaders.map((x) => (
                        <option key={x} value={x}>
                          {countries[x].name}
                        </option>
                      ))}
                    </select>
                    {btn(
                      "加入关税同盟",
                      { type: "joinUnion", countryId: id, leaderId: leader },
                      unionDisabled,
                    )}
                  </>
                )}
          </div>
        </section>
      </div>
    </section>
  );
}
