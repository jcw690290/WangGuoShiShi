# AGENTS.md

## 项目目标

- 王国史诗是一个从 1820 年开局的浏览器大战略游戏，核心是人口与经济模拟，以及政治、科技、外交和战争之间的相互影响。
- 当前交付是机制完整的本地单机 Demo。玩家控制一个国家，其余国家由规则 AI 操作。通过 `localhost` 试玩，模拟和存档在浏览器中运行。VPS 部署和多人联机留待单机 Demo 验收后另行安排。
- 用小剧本验证系统之间的联系。Demo 暂以约 3 个国家、8–12 个州和 2–3 年的可玩时长为目标。调整规模以实际试玩为准。

## 技术约定

- 使用 React、Vite 和 TypeScript，地图用 PixiJS，浏览器存档用 IndexedDB。优先保持本地启动流程简单。
- 模拟引擎是独立的 TypeScript 模块。React 和 PixiJS 读取游戏状态并发送指令。玩家和 AI 通过同一个指令接口更新状态，使用相同的规则校验。
- 游戏开局暂停，完整 Demo 支持按天、周、半年推进。所有推进跨度共用同一套日步进。经过周结算点时执行经济、人口和建设结算，并保持结算顺序明确。使用可复现的随机种子，存档带版本，读档后能继续推进。
- 静态剧本数据、运行中的游戏状态和地图几何分别读取和维护。地图着色以游戏状态里的州归属为准，便于以后反映和约和领土变化。

## 地图和剧本数据

- `resources/victoria3_1820_states.geojson` 包含 660 个州的几何和初始归属。坐标使用原图的 `1200 × 575` 平面坐标，读取时支持 `Polygon` 和 `MultiPolygon`。
- `resources/1820_game_data.json` 提供 1820 年的国家列表和 544 个州的初始归属。其余 116 个地图要素按未分配处理。用 GeoJSON 的 `properties.id` 关联州数据，保留既有州和国家 ID。可将地图的初始 `countryId` 映射为游戏状态中的 `ownerId`。
- `resources/victoria3_1820_colored.svg` 用于核对边界和初始着色。保留原始地图文件。小剧本通过稳定 ID 引用所选州，人口、资源和产业初始值另存为剧本数据，注明历史依据或平衡假设。
- 当前协作仓库公开。将第三方地图资源纳入公开提交前，先确认允许再分发。

## 里程碑与验收

1. **可运行开局。** 从现有地图选择同一区域的 2 国、4 个相邻州。可选国、点州查看所属国家。自 `1820-01-01` 暂停开局，推进一周至 `1820-01-08`。通过一个本地存档槽保存，刷新后读档能恢复日期、玩家国家和州归属。
2. **经济与人口。** 跑通建设排队、完工、就业、工资、产出、价格和税收。让至少一个 AI 国家能识别商品短缺并下达建设指令。
3. **政治与科技。** 人口和财富变化会影响利益集团。实现至少一项可试玩的法律改革和一项研究，效果进入后续模拟结算。
4. **外交与战争。** 为剧本内的州补齐必要的邻接和补给数据。外交争端可通过谈判解决或升级为战争。征兵影响劳动力，军需影响战线，和约能更新州归属。
5. **完整单机 Demo。** 从选国玩到剧本目标达成或期限届满，可中途存档续玩。除玩家外的国家能自主参与主要机制，并跑完整个小剧本。

每次任务明确一个可试玩结果和验收步骤。修改机制后，运行项目已有的相关测试、类型检查和构建，并通过本地页面核对本次涉及的玩家操作。交付时说明启动方式、验证结果和仍需人工确认的步骤。

## GitHub 协作

- 共用 [jcw690290/WangGuoShiShi](https://github.com/jcw690290/WangGuoShiShi)，默认分支为 `main`。保持 `main` 可运行。各自从最新的 `main` 创建功能分支，例如 `feature/map-interaction` 或 `feature/construction`。
- 当前由项目发起人在本地用 Codex 逐项实现并试玩。朋友参与时，可按功能分工，地图和界面、模拟和 AI 可以并行。涉及州或国家 ID、公共指令、结算顺序或存档格式时，先对齐接口和验收方法。
- 用 GitHub Issue 或 PR 描述记录目标和验收步骤。功能验证后开 PR，由另一人检查或试玩再合并。PR 写清改动、验证命令和需要联动的接口变化。

## Coding Style: Fail Fast, No Defensive Bloat

Follow a strict **Fail-Fast** and **Validate-at-Boundaries** philosophy. Do NOT write defensive code that masks bugs or duplicates type-system guarantees.

### 1. Trust Internal Contracts & Types
- **Do not re-validate** arguments, object shapes, or non-null invariants inside internal functions when they are already guaranteed by the type system or validated at the entry point.
- **No speculative null checks**: Do not add `if (!x) return`, optional chaining (`?.`), or fallback defaults (`?? []`, `|| ""`) for values that *must* exist by design. If an invariant is violated, let it throw immediately.

### 2. Validate Strictly at System Boundaries
- Perform schema/input validation **only** at I/O boundaries: HTTP/RPC handlers, CLI args, environment variables, database/file reads, and third-party API responses.
- Once data crosses the boundary into core business logic, treat it as trusted and valid.

### 3. Never Swallow Errors
- **No broad `try/catch` blocks** around business logic.
- **Never catch an error just to log it and return `null`, `false`, `[]`, or `{}`.**
- Only catch an exception when you have a concrete recovery strategy (e.g., retry a transient network error, translate to a domain/HTTP error at the boundary). Otherwise, let the exception propagate.

### 4. No Unrequested Fallbacks or Shims
- Do not add backward-compatibility fallbacks, dual-path parsing, or silent retries unless explicitly requested in the prompt.
- One clear code path is preferred over multiple speculative fallbacks.

### Examples

**BAD (Defensive — hides bugs and adds noise):**
```ts
function calculateTotal(order: Order): number {
  try {
    if (!order || !Array.isArray(order.items)) {
      return 0; // Silently masks a broken caller or invalid state
    }
    return order.items.reduce((sum, item) => sum + (item?.price ?? 0), 0);
  } catch (e) {
    console.error("Failed to calculate total", e);
    return 0;
  }
}
```

**GOOD (Fail-Fast — trusts types and surfaces bugs immediately):**
```ts
function calculateTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.price, 0);
}
```
