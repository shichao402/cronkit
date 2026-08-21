import panelHtml from "../../src/renderer/index.html?raw";
import "../../src/renderer/styles.css";
import { installMockApi } from "./mock-api";
import "./preview.css";

installMockApi();

const parsed = new DOMParser().parseFromString(panelHtml, "text/html");
parsed.querySelectorAll("script, link[rel='stylesheet']").forEach((node) => node.remove());
document.body.append(...Array.from(parsed.body.childNodes));

await import("../../src/renderer/renderer");
