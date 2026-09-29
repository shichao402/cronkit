/**
 * relkit `ci release` 的唯一打包入口。
 *
 * `npm run dist` 产出首次安装包、内部更新 payload 和供人工下载的 zip；
 * 本脚本随后写出 relkit.release-artifacts/2 清单（结构化 selectorGroups，
 * selectors 为对象 map，无字符串解析），由 `relkit ci release` 统一 stage。
 *
 * cronkit 是单组产物（win-x64 installer + payload + ci-only archive），
 * /2 形状下即一个 selectorGroup，保持「形状即真实」。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "VERSION.json"), "utf8"));

// 防旧 manifest 静默复用（cronkit#1 场景 C）：进 dist 之前先清掉上一轮
// release-artifacts.json。若后续 dist 失败，staging 拿不到 manifest 直接
// 报错，绝不会拿旧版本号对应关系继续走。
const staleManifest = path.join(root, "dist", "release-artifacts.json");
if (existsSync(staleManifest)) {
  rmSync(staleManifest);
  console.log(`release manifest: removed stale ${path.relative(root, staleManifest)}`);
}

const npmCommand =
  process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run dist"]]
    : ["npm", ["run", "dist"]];
execFileSync(npmCommand[0], npmCommand[1], { cwd: root, stdio: "inherit" });

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

const selectors = { os: "windows", arch: "x64" };

const manifest = {
  schema: "relkit.release-artifacts/2",
  version,
  selectorGroups: [
    {
      selectors,
      install: {
        path: relativeSetup,
        kind: "installer",
        filename: `cronkit-${version}-win-x64-setup.exe`,
      },
      payloads: [
        {
          path: relativePayload,
          filename: `cronkit-${version}-win-x64-payload.zip`,
          selectors,
        },
      ],
    },
  ],
  archives: [{ path: relativeZip, role: "ci-only" }],
};

mkdirSync(path.join(root, "dist"), { recursive: true });
writeFileSync(
  path.join(root, "dist", "release-artifacts.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log("release manifest: dist/release-artifacts.json");
