import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadGeometry } from "./map/geometry.ts";
import { atlas, scenario } from "./scenario/scenario.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
loadGeometry(Object.keys(atlas)).then(
  (geometry) => root.render(<App scenario={scenario} geometry={geometry} />),
  (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    root.render(<p role="alert">无法载入剧本。{detail}</p>);
  },
);
