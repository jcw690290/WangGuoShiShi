import { facilityNames, facilityTypes, socialTags, accepted } from "./game/society.ts";
import { projects, privateShareOf, weeklyBudgets } from "./game/economy.ts";
import { count, silver } from "./format.ts";
import { constructionError, workForce } from "./game/economy.ts";
import type { EconomyReport } from "./game/economy.ts";
import type { GameCommand, GameState } from "./game/engine.ts";
import { goods, industries } from "./game/industry.ts";
import type { Scenario } from "./scenario/scenario.ts";

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
    report.states[stateId].armourers;
  const isOwnState = game.ownerByStateId[stateId] === playerId;

  const owner = game.ownerByStateId[stateId],
    society = game.societies[stateId],
    snapshot = report.states[stateId];
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
          <dt>常备军 / 建筑 / 军工工人</dt>
          <dd>
            {snapshot.regulars} / {snapshot.builders} / {snapshot.armourers}
          </dd>
        </div>
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
                  {local.buildings[good]} / {site.capacity[good]} 级
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
                  {["职业 / 阶层", "文化 / 信仰", "人口", "财富", "识字率", "激进比例"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {society.pops.map((p) => (
                  <tr key={p.occupation + p.culture}>
                    <td>
                      {p.occupation} / {socialTags[p.occupation][0]}
                    </td>
                    <td>
                      {scenario.countries[p.culture]?.name ?? "地方文化"} /{" "}
                      {scenario.countries[p.religion] ? "国教" : "地方信仰"} ·{" "}
                      {accepted(p, owner, game.nations[owner]) ? "接纳" : "受歧视"}
                    </td>
                    <td>{count(p.people)}</td>
                    <td>{p.wealth.toFixed(1)}</td>
                    <td>{p.literacy.toFixed(1)}%</td>
                    <td>{p.radicals.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

export function EconomyPanel({ scenario, game, playerId, selectedId, report, busy, send, onPopulationOpen }: Props) {
  const marketId = selectedId === null ? playerId : game.ownerByStateId[selectedId];
  const country = scenario.countries[marketId];
  const { market, tax, wageTaxRate, upkeep, tribute } = report.countries[marketId];
  const { tributeReceived, balance } = weeklyBudgets(game.nations, report)[marketId];
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
              <dt>周军费（常备军与军工工资）</dt>
              <dd>{silver(upkeep)}</dd>
            </div>
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
                        {good === "grain" || good === "cloth" ? industries[good].name : facilityNames[good]} ·
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
