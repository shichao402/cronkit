import { installMockApi } from "./mock-api";
import "../../src/renderer/styles.css";
import "./preview.css";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App";

installMockApi();

const mount = document.getElementById("root");
if (!mount) {
  throw new Error("缺少 #root");
}
createRoot(mount).render(<App />);
