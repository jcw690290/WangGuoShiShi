import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadGeometry } from "./map/geometry.ts";
import { listGameSaves } from "./game/storage.ts";
import { atlas, scenario } from "./scenario/scenario.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(<p role="status">正在加载剧本和存档列表…</p>);
void Promise.allSettled([loadGeometry(Object.keys(atlas)), listGameSaves()]).then(([geometry, saves]) => {
  if (geometry.status === "rejected") {
    const error: unknown = geometry.reason;
    const detail = error instanceof Error ? error.message : String(error);
    root.render(<p role="alert">无法载入剧本。{detail}</p>);
    return;
  }
  root.render(<App scenario={scenario} geometry={geometry.value}
    initialSaves={saves.status === "fulfilled" ? saves.value : null}
    initialSaveNotice={saves.status === "rejected" ? "无法读取存档列表 · " + String(saves.reason) : ""} />);
});
