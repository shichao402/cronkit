/**
 * relkit `ci release` 的唯一打包入口。
 *
 * `npm run dist` 产出首次安装包、内部更新 payload 和供人工下载的 zip；
 * 本脚本随后写出 relkit.release-artifacts/1 清单，由 host 脚本统一 stage。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "VERSION.json"), "utf8"));

execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dist"], {
  cwd: root,
  stdio: "inherit",
});

const relativeSetup = `dist/cronkit-${version}-win-x64-setup.exe`;
const relativeZip = `dist/cronkit-${version}-win-x64.zip`;
const relativePayload = `.release/versioned/versions/${version}`;

for (const relative of [relativeSetup, relativeZip]) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute) || statSync(absolute).size === 0) {
    throw new Error(`缺少发布产物：${relative}`);
  }
}
if (!existsSync(path.join(root, relativePayload))) {
  throw new Error(`缺少内部更新 payload：${relativePayload}`);
}

const manifest = {
  schema: "relkit.release-artifacts/1",
  version,
  install: {
    path: relativeSetup,
    kind: "installer",
    selectors: "os=windows,arch=x64",
  },
  payload: {
    path: relativePayload,
    selectors: "os=windows,arch=x64",
  },
  archives: [{ path: relativeZip, role: "ci-only" }],
};

mkdirSync(path.join(root, "dist"), { recursive: true });
writeFileSync(
  path.join(root, "dist", "release-artifacts.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log("release manifest: dist/release-artifacts.json");
