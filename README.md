# WangGuoShiShi
Ni Hao Wang Hong Yu
Ke Bi Lai Xi

## 王国史诗 · 1820 世界剧本

本地浏览器单机 Demo。可从 29 个国家中选国，在 660 个州的地图上推进经济、人口、政治、科技、外交和战争。

使用 Node.js 22.18 或更高版本，在仓库根目录运行：

```sh
npm ci
npm run dev
```

打开 [本地游戏](http://localhost:5173)。

地图支持单指拖动、双指捏合缩放和轻触选州；桌面可用滚轮、方向键、`+` / `-` 和 `Home`。保留“定位选中州”和“全图”，不再使用放大/缩小按钮。选国后搜索或点选无主州，支付 **500 两**即可占领，立即获得人口、市场和建设权限（Demo 平衡值，不限制接壤或跨海）。占领结果可正常存读档。

验证使用 `npm test` 和 `npm run build`，构建包含类型检查。[机制与试玩记录](MECHANICS.md) · [地图署名与许可](resources/MAP-LICENSE.md)
