import { useMemo } from "react";
import { facilityNames, facilityTypes, livingStandardOf, socialTags, accepted } from "./game/society.ts";
import { projects, privateShareOf, weeklyBudgets } from "./game/economy.ts";
import { count, silver } from "./format.ts";
import { constructionError, workForce } from "./game/economy.ts";
import type { EconomyReport } from "./game/economy.ts";
import type { GameCommand, GameState } from "./game/engine.ts";
import { goods, industrialGoods, industries, isGood } from "./game/industry.ts";
import type { Scenario } from "./scenario/scenario.ts";
import { affinityLevel, culturalAffinityOf } from "./game/culture.ts";
import { governanceModes, governanceOf, governanceRules, integrationDuration, integrationStaffNeeded } from "./game/governance.ts";
import type { GovernanceMode } from "./game/governance.ts";
import { TradePanel } from "./TradePanel.tsx";
import { convoyCargoCapacity } from "./game/transport.ts";
import { incidentNames, unrestEffects } from "./game/unrest.ts";

function cultureName(scenario: Scenario, id: string) {
  const separator = id.indexOf("-");
  if (separator === -1 || id.startsWith("country_")) return scenario.countries[id]?.name ?? id;
  const state = scenario.states[id.slice(separator + 1)];
  return state ? state.name + "地方文化" : id;
}

interface Props {
  scenario: Scenario;
  game: GameState;
  playerId: string;
  selectedId: string | null;
  report: EconomyReport;
  busy: boolean;
  send: (command: GameCommand) => void;
  onPopulationOpen: () => void;
}

function StateIndustry({
  scenario,
  game,
  playerId,
  stateId,
  report,
  busy,
  send,
  onPopulationOpen,
}: Omit<Props, "selectedId"> & { stateId: string }) {
  const site = scenario.states[stateId];
  const local = game.stateEconomies[stateId];
  const { industries: activity, populationChange, conscripts } = report.states[stateId];
  const monthlyChange = game.lastPopulation?.changes[stateId];
  const employed = goods.reduce((sum, good) => sum + activity[good].employed, 0);
  const workforce =
    workForce(local.population) -
    conscripts -
    report.states[stateId].builders -
    report.states[stateId].regulars -
    report.states[stateId].armourers -
    Math.ceil(report.states[stateId].universityStaff ?? 0) -
    Math.ceil(report.states[stateId].administrationStaff ?? 0) -
    (report.states[stateId].office?.staff ?? 0);
  const isOwnState = game.ownerByStateId[stateId] === playerId;

  const owner = game.ownerByStateId[stateId],
    society = game.societies[stateId],
    snapshot = report.states[stateId];
  const governance = governanceOf(society);
  const rule = governanceRules[governance.mode];
  const occupied = game.occupation?.stateId === stateId;
  const integrationActive = governance.integration !== null;
  const stability = society.stability;
  const incident = stability?.incident;
  const localEffects = unrestEffects(stability);
  return (
    <section className="panel" aria-labelledby="industry-title">
      <header className="panel-header">
        <h3 id="industry-title">{site.name}产业</h3>
      </header>
      <dl className="economy-stats">
        <div>
          <dt>人口</dt>
          <dd>
            {count(local.population)} 人
            {monthlyChange !== undefined && (
              <small>（上次月结 {monthlyChange > 0 ? "+" : ""}{count(monthlyChange)}）</small>
            )}
            {monthlyChange === undefined && populationChange !== undefined && populationChange !== 0 && (
              <small>
                （{populationChange > 0 ? "+" : ""}
                {count(populationChange)}）
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>就业 / 劳动力</dt>
          <dd>
            {count(employed)} / {count(workforce)} 人
          </dd>
        </div>
        <div>
          <dt>市场接入</dt>
          <dd>{Math.round(snapshot.access * 100)}%</dd>
        </div>
        <div>
          <dt>生活水平</dt>
          <dd>{livingStandardOf(society.pops).toFixed(1)}</dd>
        </div>
        {snapshot.householdConsumption && <div>
          <dt>家庭到货</dt>
          <dd>粮食 {count(snapshot.householdConsumption.grain)} · 布匹 {count(snapshot.householdConsumption.cloth)} ·
            木材 {count(snapshot.householdConsumption.wood)} · 服务 {count(snapshot.householdConsumption.services)}</dd>
          <small>粮食满足 {Math.round(snapshot.foodFulfillment! * 100)}%</small>
        </div>}
        <div>
          <dt>常备军 / 建筑 / 军工</dt>
          <dd>
            {snapshot.regulars} / {snapshot.builders} / {snapshot.armourers}
          </dd>
        </div>
        {snapshot.universityStaff !== undefined && society.university > 0 && <div>
          <dt>大学周实付岗位</dt>
          <dd>{snapshot.universityStaff.toFixed(1)}（全周等效）</dd>
        </div>}
        {conscripts > 0 && (
          <div>
            <dt>征兵占用</dt>
            <dd>{count(conscripts)} 人</dd>
          </div>
        )}
      </dl>
      <ul className="industry-list">
        {goods.map((good) => {
          const industry = industries[good];
          const jobs = activity[good];
          const problem = isOwnState ? constructionError(scenario, game, playerId, stateId, good) : undefined;
          return (
            <li key={good}>
              <div>
                <strong>{industry.name}</strong>{" "}
                <span>
                  {local.buildings[good]} / {site.capacity[good] ?? 0} 级
                </span>
                <p>
                  就业 {count(jobs.employed)} 人 · 周产出 {count(jobs.output)} · 本地价{" "}
                  {silver(snapshot.localPrices[good])} · 人均周工资{" "}
                  {jobs.employed === 0 ? "—" : silver(jobs.wages / jobs.employed)}
                </p>
              </div>
              {isOwnState && (
                <button
                  className="build"
                  disabled={busy || problem !== undefined}
                  aria-label={`建设${industry.name}`}
                  onClick={() => send({ type: "queueConstruction", countryId: playerId, stateId, good })}
                >
                  建设{industry.name}
                  <small>{problem ?? `${silver(industry.cost)} · ${industry.weeks} 建造点`}</small>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="control-block">
        {snapshot.industrial && <details>
          <summary>工业库存与周转资金</summary>
          <p>周转金 {silver(snapshot.industrial.capital)} · 销售 {silver(snapshot.industrial.sales)} · 采购 {silver(snapshot.industrial.spent)} · 可分配结余 {silver(snapshot.industrial.distributed)}</p>
          <div className="economy-table">
            <table>
              <thead><tr><th scope="col">商品</th><th scope="col">消耗</th><th scope="col">采购</th><th scope="col">余量</th></tr></thead>
              <tbody>{industrialGoods.map((good) => <tr key={good}>
                <td>{industries[good].goodName}</td>
                <td>{count(snapshot.industrial!.used[good])}</td>
                <td>{count(snapshot.industrial!.bought[good])}</td>
                <td>{count(snapshot.industrial!.stocks[good])}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>}
        <div className="diplomacy-actions">
          {facilityTypes.map((g) => (
            <button
              key={g}
              className="build"
              disabled={!isOwnState || busy || !!constructionError(scenario, game, playerId, stateId, g)}
              onClick={() => send({ type: "queueConstruction", countryId: playerId, stateId, good: g })}
            >
              {facilityNames[g]} {society[g]} 级 · 扩建
              <small>
                {silver(projects[g].cost)} · {projects[g].weeks} 建造点
              </small>
            </button>
          ))}
        </div>
        <details onToggle={(event) => { if (event.currentTarget.open) onPopulationOpen(); }}>
          <summary>人口群体 · 职业、文化与生活水平</summary>
          <div className="economy-table">
            <table>
              <thead>
                <tr>
                  {["职业 / 阶层", "文化 / 信仰", "人口", "财富", "生活水平", "识字率", "激进比例"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {society.pops.map((p) => (
                  <tr key={JSON.stringify([p.occupation, p.culture, p.religion])}>
                    <td>
                      {p.occupation} / {socialTags[p.occupation][0]}
                    </td>
                    <td>
                      {cultureName(scenario, p.culture)} /{" "}
                      {scenario.countries[p.religion] ? "国教" : "地方信仰"} ·{" "}
                      {accepted(p, owner, game.nations[owner]) ? "接纳" : "受歧视"}
                    </td>
                    <td>{count(p.people)}</td>
                    <td>{p.wealth.toFixed(1)}</td>
                    <td>{p.livingStandard.toFixed(1)}</td>
                    <td>{p.literacy.toFixed(1)}%</td>
                    <td>{p.radicals.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>文化亲近度</summary>
          <div className="economy-table">
            <table>
              <thead><tr><th scope="col">文化</th><th scope="col">亲近度</th><th scope="col">接触阶段</th></tr></thead>
              <tbody>
                {Object.entries(culturalAffinityOf(society)).sort(([, left], [, right]) => right - left).map(([culture, value]) => (
                  <tr key={culture}>
                    <td>{cultureName(scenario, culture)}</td>
                    <td>{Math.floor(value)} / 100</td>
                    <td>{affinityLevel(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>地方治理 · {rule.name}</summary>
          <p>{governance.integrated ? "已整合" : "未整合"} · 中央税权 {rule.centralTax}% · 驻军与征兵额度 {Math.round(rule.militaryShare * 100)}%</p>
          {snapshot.office && <>
            <p>行政署 {society.bureaucracy} 级 · 治理覆盖 {Math.round(snapshot.office.coverage * 100)}% · 实付岗位 {count(snapshot.office.staff)} / {count(Math.ceil(snapshot.office.need))}</p>
            <p>周到货 纸张 {count(snapshot.office.paper)} / {count(snapshot.office.paperDemand)} · 服务 {count(snapshot.office.services)} / {count(snapshot.office.serviceDemand)}</p>
            <p>周工资 {silver(snapshot.office.wages)} · 采购支出 {silver(snapshot.office.purchases)}</p>
          </>}
          {stability && <p>地方动乱 {stability.unrest.toFixed(1)} / 100</p>}
          {incident && <>
            <p>{incidentNames[incident.cause]} · 已持续 {count(game.elapsedDays - incident.since)} 天{incident.negotiated && " · 已达成减税协议"}</p>
            <p>当地产出 {Math.round(localEffects.output * 100)}% · 中央征收效率 {Math.round(localEffects.collection * 100)}% · 运力 {Math.round(localEffects.transport * 100)}%</p>
            {isOwnState && !incident.negotiated && <button className="build" disabled={busy || occupied}
              onClick={() => send({ type: "negotiateLocalUnrest", countryId: playerId, stateId })}>
              协商减税以缓解动乱
            </button>}
          </>}
          {occupied && <p>军事占领暂停中央征收和行政整合。</p>}
          {integrationActive && (
            <p>整合 {governance.integration!.months.toFixed(1)} / {integrationDuration} 月 ·
              实付行政岗位 {(snapshot.administrationStaff ?? 0).toFixed(1)} /
              {integrationStaffNeeded(local.population, game.settings.difficulty)}
            </p>
          )}
          {isOwnState && (
            <>
              <label>
                治理方式
                <select
                  value={governance.mode}
                  disabled={busy || occupied}
                  onChange={(event) => send({
                    type: "setLocalGovernance", countryId: playerId, stateId, mode: event.target.value as GovernanceMode,
                  })}
                >
                  {governanceModes.map((mode) => (
                    <option key={mode} value={mode} disabled={mode === "PROVINCE" && !governance.integrated}>
                      {governanceRules[mode].name}
                    </option>
                  ))}
                </select>
              </label>
              {!governance.integrated && (
                <button
                  className="build"
                  disabled={busy || occupied}
                  onClick={() => send({ type: integrationActive ? "cancelIntegration" : "startIntegration", countryId: playerId, stateId })}
                >
                  {integrationActive ? "取消整合并清除进度" : "安排行政整合"}
                </button>
              )}
            </>
          )}
        </details>
        <TradePanel key={stateId} {...{ scenario, game, stateId, playerId, busy, send }} />
      </div>
    </section>
  );
}

export function EconomyPanel({ scenario, game, playerId, selectedId, report, busy, send, onPopulationOpen }: Props) {
  const marketId = selectedId === null ? playerId : game.ownerByStateId[selectedId];
  const country = scenario.countries[marketId];
  const { market, tax, wageTaxRate, upkeep, tribute, officeUpkeep } = report.countries[marketId];
  const { tributeReceived, balance } = weeklyBudgets(game.nations, report)[marketId];
  const countryLiving = useMemo(() => livingStandardOf(Object.entries(game.societies)
    .filter(([stateId]) => game.ownerByStateId[stateId] === marketId).flatMap(([, site]) => site.pops)),
  [game.societies, game.ownerByStateId, marketId]);
  const fiscal = game.countryEconomies[marketId].fiscal;
  const riskNames = { stable: "稳定", warning: "信用预警", restricted: "限制新工程", defaulted: "违约" };

  return (
    <section className="economy" aria-labelledby="economy-title">
      <header className="economy-heading">
        <h2 id="economy-title">经济与人口</h2>
        <span>
          {game.lastEconomy
            ? "最近一周结算"
            : game.elapsedDays === 0
              ? "经济初始值估算"
              : "按当前州归属估算 · 下周正式结算"}
        </span>
      </header>
      <div className="economy-grid">
        <section className="panel" aria-labelledby="market-title">
          <header className="panel-header">
            <h3 id="market-title">{country.name}市场</h3>
          </header>
          <dl className="economy-stats">
            <div>
              <dt>关税市场</dt>
              <dd>{scenario.countries[game.nations[marketId].marketLeader ?? marketId].name}</dd>
            </div>
            <div>
              <dt>私人投资池</dt>
              <dd>{silver(game.nations[marketId].investment)}</dd>
            </div>
            <div>
              <dt>周投资注入</dt>
              <dd>{silver(report.countries[marketId].investment)}</dd>
            </div>
            <div>
              <dt>周公共支出（军费与大学工资）</dt>
              <dd>{silver(upkeep)}</dd>
              {officeUpkeep !== undefined && <small>其中行政署 {silver(officeUpkeep)}</small>}
            </div>
            {report.countries[marketId].universityWages !== undefined && <div>
              <dt>大学实付工资</dt>
              <dd>{silver(report.countries[marketId].universityWages!)}</dd>
            </div>}
            {(report.countries[marketId].tradeTariff ?? 0) > 0 && <div>
              <dt>实收进口关税</dt>
              <dd>{silver(report.countries[marketId].tradeTariff!)}</dd>
            </div>}
            {report.countries[marketId].tradeSeaCargo !== undefined && <div>
              <dt>船队总运力</dt>
              <dd>{count(game.nations[marketId].convoys * convoyCargoCapacity)}</dd>
              <small>商用 {count(report.countries[marketId].tradeSeaCargo!)} · 军需 {count(report.countries[marketId].military.seaCargoUsed ?? 0)}</small>
            </div>}
            <div>
              <dt>贡金收入 / 上缴</dt>
              <dd>{silver(tributeReceived)} / {silver(tribute)}</dd>
            </div>
            <div>
              <dt>周经常收支（含利息）</dt>
              <dd>{silver(balance)}</dd>
            </div>
            <div>
              <dt>国库</dt>
              <dd>{silver(game.countryEconomies[marketId].treasury)}</dd>
            </div>
            <div>
              <dt>平均生活水平</dt>
              <dd>{countryLiving > 0 ? countryLiving.toFixed(1) : "—"}</dd>
            </div>
            <div>
              <dt>周税收（工资税 {wageTaxRate}%）</dt>
              <dd>{silver(tax)}</dd>
            </div>
          </dl>
          {fiscal && <details className="control-block">
            <summary>财政信用 · {riskNames[fiscal.week.risk]} · 债务 {silver(fiscal.debt)}</summary>
            <p>信用上限 {silver(fiscal.week.creditLimit)} · 年利率 {(fiscal.week.annualRate * 100).toFixed(2)}%</p>
            <p>本周借款 {silver(fiscal.week.borrowed)} · 偿还本金 {silver(fiscal.week.repaid)}</p>
            <p>支付利息 {silver(fiscal.week.interestPaid)} · 未付利息 {silver(fiscal.arrears)}</p>
            <p>必要支出实付 {silver(fiscal.week.upkeepPaid)} ／ 应付 {silver(fiscal.week.upkeepDue)}</p>
          </details>}
          <div className="economy-table">
            <table aria-label={`${country.name}商品供需`}>
              <thead>
                <tr>
                  <th scope="col">商品</th>
                  <th scope="col">周市场供给</th>
                  <th scope="col">周需求</th>
                  <th scope="col">参考价</th>
                  <th scope="col">成交</th>
                  <th scope="col">未满足</th>
                </tr>
              </thead>
              <tbody>
                {goods.map((good) => {
                  const { demand, supply, price, traded, targetPrice } = market[good];
                  const unmet = traded === undefined ? undefined : demand - traded;
                  return (
                    <tr key={good}>
                      <th scope="row">{industries[good].goodName}</th>
                      <td>{count(supply)}</td>
                      <td>{count(demand)}</td>
                      <td>
                        {silver(price)}
                        {targetPrice !== undefined && <><br /><small>目标 {silver(targetPrice)}</small></>}
                      </td>
                      <td>{traded === undefined ? "未记录" : count(traded)}</td>
                      <td className={unmet ? "shortage" : undefined}>{unmet === undefined ? "未记录" : count(unmet)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        {selectedId !== null && (
          <StateIndustry
            onPopulationOpen={onPopulationOpen}
            scenario={scenario}
            game={game}
            playerId={playerId}
            stateId={selectedId}
            report={report}
            busy={busy}
            send={send}
          />
        )}
      </div>
      <section className="panel" aria-labelledby="queue-title">
        <header className="panel-header">
          <h3 id="queue-title">建设队列</h3>
          <span>两类队列共享建造力，空余份额流向另一队列</span>
        </header>
        <div className="queue-grid">
          {(["政府", "私人"] as const).map((kind) => {
            const queue =
              kind === "政府" ? game.countryEconomies[marketId].queue : game.nations[marketId].privateQueue;
            return (
              <div className="country-queue" key={kind}>
                <h4>
                  {country.name} · {kind}
                </h4>
                {queue.length ? (
                  <ol>
                    {queue.map(({ stateId, good, weeksLeft }, i) => (
                      <li key={i}>
                        {scenario.states[stateId].name} ·{" "}
                        {isGood(good) ? industries[good].name : facilityNames[good]} ·
                        余 {weeksLeft.toFixed(2)} 点
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>暂无工程</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="save-notice">
          本周可用建造力 {report.countries[marketId].capacity.toFixed(2)} 点 · 私人份额{" "}
          {100 * privateShareOf(game.nations[marketId])}%
        </p>
      </section>
    </section>
  );
}
