import { useMemo, useState } from "react";
import {
  attacking,
  canAddGoal,
  canDemandGoal,
  canReach,
  frontLine,
  frontObjectives,
  goalNames,
  goals,
  holdings,
  infamyLevel,
  interested,
  participants,
  peaceTermsError,
  swayCost,
  supplyPriorities,
  supplyPriorityDetails,
  warWillingness,
} from "./game/diplomacy.ts";
import type { BorderDispute, Goal } from "./game/diplomacy.ts";
import type { EconomyReport } from "./game/economy.ts";
import type { GameCommand, GameState } from "./game/engine.ts";
import type { Scenario } from "./scenario/scenario.ts";
import { tieNames, tiePartner } from "./game/diplomatic-ties.ts";
import { diplomaticGiftCost, diplomaticTrust, foreignCommandError, influenceBudget, relationBetween,
  treatyBetween, treatyKinds, treatyNames } from "./game/foreign-relations.ts";
import { countryDisplayName } from "./game/constitution.ts";
import { silver } from "./format.ts";
import { battalionDetails, battalionKinds, battalionOrderError, battalionSize, battalionsAt } from "./game/military.ts";
import { injuredPersonnel } from "./game/military-health.ts";
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
  countdown: "最后谈判",
  war: "战争",
  resolved: "已结束",
};

function peaceSummary(goals: Goal[], commercial: boolean) {
  const terms = goals.map((goal) => goalNames[goal]);
  if (commercial) terms.push("开放通商");
  return terms.join("、") || "维持现状";
}

function ArmyRoster({ scenario, game, playerId, busy, send, selectedId }: Omit<Props, "report">) {
  const [district, setDistrict] = useState("");
  const sites = holdings(scenario, game, playerId).filter((site) => game.societies[site.id].barracks > 0);
  const active = sites.find((site) => site.id === district) ?? sites.find((site) => site.id === selectedId) ?? sites[0];
  if (!active) return null;
  const roster = battalionsAt(game, active.id);
  const injured = injuredPersonnel(game.societies[active.id]);
  return (
    <details>
      <summary>常备陆军</summary>
      <label>驻军州{" "}
        <select value={active.id} onChange={(event) => setDistrict(event.target.value)}>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </label>
      {injured.people > 0 && <p>{injured.people} 人正在养伤。</p>}
      {roster.length === 0 && <p>当前可征募人口不足。</p>}
      {roster.map((unit) => (
        <div key={unit.slot} className="control-block">
          <p>第 {unit.slot + 1} 营 · {battalionDetails[unit.kind].name} · {unit.personnel} / {battalionSize} 人
            {unit.trained < unit.personnel && ` · 已训练 ${unit.trained} 人 · 最迟 ${unit.readyDay - game.elapsedDays} 天后完成`}
          </p>
          <div className="diplomacy-actions">
            {battalionKinds.filter((kind) => kind !== unit.kind).map((kind) => {
              const command = { type: "reorganizeBattalion", countryId: playerId, stateId: active.id, slot: unit.slot, kind } as const;
              const error = battalionOrderError(game, command);
              return (
                <button key={kind} className="build" disabled={busy || !!error} title={error} onClick={() => send(command)}>
                  改编为{battalionDetails[kind].name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </details>
  );
}

function FrontOrders({ scenario, game, dispute, playerId, busy, send }: Omit<Props, "report" | "selectedId"> & { dispute: BorderDispute }) {
  const options = frontObjectives(scenario, game, dispute, playerId);
  const current = dispute.frontOrders?.[playerId];
  const objective = options.find(({ id }) => id === current?.objective)?.id ?? null;
  const priority = current?.priority ?? "front";
  return (
    <div className="diplomacy-actions">
      <label>战区目标{" "}
        <select disabled={busy} value={objective ?? ""} onChange={(event) =>
          send({ type: "setFrontOrder", countryId: playerId, objective: event.target.value || null, priority })}>
          <option value="">随当前战线部署</option>
          {options.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </label>
      <label>补给优先级{" "}
        <select disabled={busy} value={priority} onChange={(event) =>
          send({ type: "setFrontOrder", countryId: playerId, objective, priority: supplyPriorities[event.target.selectedIndex] })}>
          {supplyPriorities.map((level) => {
            const details = supplyPriorityDetails[level];
            return <option key={level} value={level}>{details.name} · 调用上限 {Math.round(details.share * 100)}%</option>;
          })}
        </select>
      </label>
    </div>
  );
}

function PeaceNegotiation({ game, dispute, id, busy, send }: {
  game: GameState; dispute: BorderDispute; id: string; busy: boolean; send: Props["send"];
}) {
  const [selected, setSelected] = useState<Goal[]>([dispute.goals[0]]);
  const [commercial, setCommercial] = useState(false);
  const offer = dispute.peaceOffer;
  const terms = dispute.goals.filter((goal) => selected.includes(goal));
  const problem = offer ? peaceTermsError(game, dispute, offer.goals, offer.commercial)
    : peaceTermsError(game, dispute, terms, commercial);
  return <div className="control-block">
    <p>继续战争意愿 {warWillingness(game, dispute, id)} / 100</p>
    {offer ? <>
      <p>{offer.from === id ? "等待对方答复" : "收到和约方案"} · {peaceSummary(offer.goals, offer.commercial)}</p>
      {offer.from !== id && <div className="diplomacy-actions">
        <button className="build" disabled={busy || problem !== undefined}
          onClick={() => send({ type: "acceptPeace", countryId: id })}>接受和约</button>
        <button className="build" disabled={busy}
          onClick={() => send({ type: "rejectPeace", countryId: id })}>拒绝方案</button>
      </div>}
    </> : <>
      <fieldset>
        <legend>和约条款</legend>
        {dispute.goals.map((goal, index) => <label key={goal}>
          <input type="checkbox" checked={selected.includes(goal)} disabled={busy}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelected((current) => checked ? [...current, goal] : current.filter((entry) => entry !== goal));
            }} />
          {index === 0 ? "核心" : "追加"} · {goalNames[goal]}
        </label>)}
        <label><input type="checkbox" checked={commercial} disabled={busy}
          onChange={(event) => setCommercial(event.target.checked)} />开放通商</label>
      </fieldset>
      <button className="build" disabled={busy || problem !== undefined}
        onClick={() => send({ type: "proposePeace", countryId: id, goals: terms, commercial })}>
        {terms.length === 0 && !commercial ? "提出维持现状" : "提出和约"}
      </button>
    </>}
    {problem && <small>{problem}</small>}
  </div>;
}

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
    [ally, setAlly] = useState(""),
    [foreignChoice, setForeignChoice] = useState("");
  const live = Object.keys(countries).filter((x) => Object.values(game.ownerByStateId).includes(x));
  const foreignCountries = live.filter((countryId) => countryId !== id);
  const foreignPartner = foreignCountries.includes(foreignChoice) ? foreignChoice : foreignCountries[0];
  const relation = foreignPartner ? relationBetween(game, id, foreignPartner) : undefined;
  const influence = influenceBudget(game, id);
  const incoming = game.treatyOffers?.filter((offer) => offer.to === id) ?? [];
  const outgoing = game.treatyOffers?.filter((offer) => offer.from === id) ?? [];
  const leaders = live.filter((x) => x !== id && !game.nations[x].marketLeader);
  const leader = leaders.includes(union) ? union : leaders[0];
  const ties = game.diplomaticTies?.flatMap((tie) => {
    const partnerId = tiePartner(tie, id);
    return partnerId === undefined ? [] : [{ kind: tie.kind, partnerId }];
  });
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
  const btn = (name: string, cmd: GameCommand, disabled = false) => (
    <button key={name} className="build" disabled={busy || disabled} onClick={() => send(cmd)}>
      {name}
    </button>
  );
  const simple = (
    type:
      | "backDown"
      | "orderAdvance"
      | "orderDefend"
      | "orderRetreat"
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
          {" · "}{infamyLevel(n.infamy)} · 外交信誉 {n.prestige} · 外交影响力 {influence.available} / {influence.capacity}
        </span>
      </header>
      <div className="economy-grid">
        <section className="panel">
          <header className="panel-header">
            <h3>外交博弈</h3>
            {d && <span>{phases[d.phase]}</span>}
          </header>
          <div className="control-block">
            <ArmyRoster scenario={scenario} game={game} playerId={id} busy={busy} send={send} selectedId={selectedId} />
            {d && (
              <p role="status">
                {countries[d.claimantId].name} → {countries[d.defenderId].name} ·{" "}
                {scenario.states[d.targetStateId].name} · 核心要求 {goalNames[d.goals[0]]}
                {d.goals.length > 1 && ` · 追加 ${d.goals.slice(1).map((g) => goalNames[g]).join("、")}`}
                {d.phase === "resolved" &&
                  " · " +
                    (d.outcome === "victory"
                      ? "条款已执行"
                      : d.outcome === "withdrawal"
                        ? "提出方撤回"
                        : "维持现状")}
                {d.unacceptedGoals && ` · 未接受 ${d.unacceptedGoals.map((g) => goalNames[g]).join("、")}`}
                {d.agreedPeace && ` · 双方同意 ${peaceSummary(d.agreedPeace.goals, d.agreedPeace.commercial)}`}
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
                        <p>胜利条款生效时向该国支付 500 两，余额不足会降低信誉。</p>
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
                          `拉拢支持 · ${swayCost(n.infamy)} 博弈点`,
                          { type: "sway", countryId: id, allyId: partner },
                          d.maneuvers < swayCost(n.infamy),
                        )}
                      </>
                    )}
                  </>
                )}
                {primary && btn(claimant ? "撤回要求" : "让步并接受核心要求", simple("backDown"))}
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
                  const orders = d.mobilization?.[x];
                  const remaining = orders ? Math.max(0, orders.readyDay - game.elapsedDays) : 0;
                  const losses = d.losses?.[x];
                  return (
                    <p key={x}>
                      {countries[x].name} · {attacking(d, x) ? "提出方" : "防守方"} ·{" "}
                      {d.retreating?.includes(x) ? "撤至后方" : d.advance.includes(x) ? "推进" : "防御"} ·
                      全国常备 {m.regulars} · 征召 {m.conscripts} ·
                      {remaining > 0 ? ` 动员准备剩 ${remaining} 天 ·` : ` 已部署征召兵 ${m.deployedConscripts ?? m.conscripts} ·`}
                      全军军粮 {m.grainDrawn} / {m.grainDemand} · 武器 {m.equipment.weapons.delivered}/
                      {m.equipment.weapons.demand}· 弹药 {m.equipment.ammunition.delivered}/
                      {m.equipment.ammunition.demand} · 军服 {m.equipment.uniforms.delivered}/
                      {m.equipment.uniforms.demand} · 前线补给 {Math.round((m.supplyRatio ?? m.readiness) * 100)}% ·
                      战备 {Math.round(m.readiness * 100)}% · 士气 {game.nations[x].morale.toFixed(0)}%
                      {losses && ` · 累计阵亡 ${losses.dead} · 伤病 ${losses.injured}`}
                    </p>
                  );
                })}
                {involved && (
                  <>
                    <FrontOrders scenario={scenario} game={game} dispute={d} playerId={id} busy={busy} send={send} />
                    <div className="diplomacy-actions">
                      {btn("下令动员", simple("mobilize"), d.mobilized.includes(id))}
                      {btn("命令推进", simple("orderAdvance"), d.advance.includes(id))}
                      {btn("命令防御", simple("orderDefend"), !d.advance.includes(id) && !d.retreating?.includes(id))}
                      {btn("撤至后方", simple("orderRetreat"), d.retreating?.includes(id))}
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
                      {claimant && btn("撤回战时要求", simple("armistice"), d.lastChange === null)}
                    </div>
                  </>
                )}
              </>
            )}
            {primary && d && (d.phase === "countdown" || d.phase === "war") &&
              <PeaceNegotiation key={`${d.claimantId}:${d.defenderId}:${d.since}`} game={game} dispute={d} id={id} busy={busy} send={send} />}
          </div>
        </section>
        <section className="panel">
          <header className="panel-header">
            <h3>条约、共同市场与附属关系</h3>
          </header>
          <div className="control-block">
            {relation && <details>
              <summary>双边外交</summary>
              <label>外交对象{" "}
                <select value={foreignPartner} onChange={(event) => setForeignChoice(event.target.value)}>
                  {foreignCountries.map((countryId) => (
                    <option key={countryId} value={countryId}>{countryDisplayName(countries[countryId], game.nations[countryId])}</option>
                  ))}
                </select>
              </label>
              <p>关系 {relation.standing} · 对方对本国信任 {diplomaticTrust(relation, foreignPartner)} / 100</p>
              {(() => {
                const command = { type: "improveRelations", countryId: id, partnerId: foreignPartner } as const;
                const problem = foreignCommandError(game, command);
                return <>{btn(`赠送外交礼金 · ${silver(diplomaticGiftCost)}`, command, problem !== undefined)}
                  {problem && <small>{problem}</small>}</>;
              })()}
              <p>防御同盟在盟国遭到外交进攻时履行防御承诺。签约未满 180 天解约会降低信任。</p>
              <div className="diplomacy-actions">
                {treatyKinds.map((kind) => {
                  const treaty = treatyBetween(game, id, foreignPartner, kind);
                  const command = { type: treaty ? "endTreaty" : "offerTreaty", countryId: id, partnerId: foreignPartner, kind } as const;
                  return btn(treaty ? `解除${treatyNames[kind]}` : `提议${treatyNames[kind]}`, command,
                    foreignCommandError(game, command) !== undefined);
                })}
              </div>
              {outgoing.length > 0 && <p>待回复 · {outgoing.map((offer) =>
                `${countryDisplayName(countries[offer.to], game.nations[offer.to])} ${treatyNames[offer.kind]}`).join("、")}</p>}
              {incoming.map((offer) => {
                const accept = { type: "acceptTreaty", countryId: id, partnerId: offer.from, kind: offer.kind } as const;
                return <div key={`${offer.from}:${offer.kind}`} className="diplomacy-actions">
                  <p>{countryDisplayName(countries[offer.from], game.nations[offer.from])}提议{treatyNames[offer.kind]}</p>
                  {btn("接受", accept, foreignCommandError(game, accept) !== undefined)}
                  {btn("拒绝", { ...accept, type: "declineTreaty" })}
                </div>;
              })}
            </details>}
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
            {!!ties?.length && <details>
              <summary>开局外交关系</summary>
              <p>这些关系保留独立市场和国库。与对方开战时关系解除。</p>
              <ul>
                {ties.map(({ kind, partnerId }) => (
                  <li key={partnerId}>
                    <p>{countries[partnerId].name} · {tieNames[kind]}</p>
                    {btn(`解除与${countries[partnerId].name}的关系`, { type: "endDiplomaticTie", countryId: id, partnerId })}
                  </li>
                ))}
              </ul>
            </details>}
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
