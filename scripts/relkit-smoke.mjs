#!/usr/bin/env node
// relkit 跨实现闭环冒烟。
//
// 为什么需要它：relkit 的 conformance 夹具是 v1 JSON schema，验证的是「语义对齐」；
// 线上真正传输的是 v2 protobuf。首次接入时正是靠本脚本抓到两个夹具覆盖不到的缺陷
// （trustedKeys 类型过窄导致崩溃、Windows 上以追加模式句柄 truncate 抛 EPERM）。
// 因此上线前必须跑一次本脚本，不能只看 npm test 全绿。
//
// 前置：
//   1. relkit CLI 可用（可在 relkit 仓库 go build -o <某处>/relkit.exe ./cmd/relkit）
//   2. rup-client 已构建（relkit/sdk/node 下 npm install && npm run build）
//   3. 已在某个目录用 local 后端 publish 过一版，且 directory set 过
//
// 用法：
//   node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port]
//
// 其中 publishDir 是 local 后端的 outputDir（内含 directory/ index/ manifest/ artifact/），
// publicKeyBase64 取自 relkit.json 的 signing.publicKeys[].publicKeyBase64。
//
// port 必须与发布时 relkit.json 里 backends.<local>.baseUrl 的端口**完全一致**（默认 18080）。
// 原因是协议要求客户端禁止自行拼接 URL（SPEC §1.1）：index / manifest / artifact 的地址
// 都是上一跳签名文档里的绝对 URL。换了端口，directory 验签能过，但它指向的 index 连不上，
// 表现为 check-failed —— 那是配置不一致，不是 SDK 有问题。

import { createServer } from "node:http";
import { createReadStream, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";

const [rawPublishDir, publicKeyBase64, rawPort] = process.argv.slice(2);
if (!rawPublishDir || !publicKeyBase64) {
  console.error(
    "usage: node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port]",
  );
  process.exit(1);
}

const publishDir = resolve(rawPublishDir);
const PORT = Number(rawPort ?? 18080);
const DEAD_PORT = PORT + 1;

let RupUpdater;
let MemoryUpdateStateStore;
try {
  ({ RupUpdater, MemoryUpdateStateStore } = await import("rup-client"));
} catch (error) {
  console.error(
    "cannot load rup-client. Add it as a dependency, e.g.\n" +
      '  "rup-client": "file:../relkit/sdk/node"\n' +
      "then run npm install and build the SDK once (npm run build in sdk/node).",
  );
  console.error(String(error));
  process.exit(1);
}

let rangeRequests = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const target = normalize(join(publishDir, rel));
  if (!target.startsWith(normalize(publishDir))) {
    res.writeHead(403).end();
    return;
  }
  let info;
  try {
    info = statSync(target);
  } catch {
    res.writeHead(404).end("not found");
    return;
  }
  const range = req.headers.range;
  if (range) {
    rangeRequests += 1;
    const matched = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = Number(matched[1]);
    const end = matched[2] ? Number(matched[2]) : info.size - 1;
    res.writeHead(206, {
      "content-range": `bytes ${start}-${end}/${info.size}`,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(target, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "content-length": String(info.size),
    "accept-ranges": "bytes",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
});

await new Promise((done) => server.listen(PORT, "127.0.0.1", done));

const base = `http://127.0.0.1:${PORT}`;
const staging = mkdtempSync(join(tmpdir(), "cronkit-smoke-dl-"));
let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function makeUpdater(overrides = {}) {
  return new RupUpdater({
    product: "cronkit",
    channel: "stable",
    currentCode: 0,
    entryUrls: [`${base}/directory/cronkit.pb`],
    trustedKeys: { "cronkit-2026": Buffer.from(publicKeyBase64, "base64") },
    clientSelectors: { os: "windows", arch: "x64" },
    stateStore: new MemoryUpdateStateStore(),
    ...overrides,
  });
}

try {
  console.log("1. fresh install sees the release");
  {
    const updater = makeUpdater();
    const result = await updater.check({ force: true });
    check("kind === update-available", result.kind === "update-available", result.kind);
    if (result.kind === "update-available") {
      check("code > 0", Number(result.target.code) > 0, String(result.target.code));
      check("artifact selected", Boolean(result.artifact), "no artifact");

      console.log("2. download passes size + sha256");
      const file = await updater.download(result, { destinationDir: staging });
      const size = statSync(file.path).size;
      check("file landed", size > 0, `size=${size}`);
      check("size matches manifest", size === Number(result.artifact.size), `size=${size}`);
      check("source url recorded", Boolean(file.sourceUrl), "no sourceUrl");
      check("server saw a Range request", rangeRequests > 0, `rangeRequests=${rangeRequests}`);
    }
    await updater.close();
  }

  console.log("3. already-current client is up to date");
  {
    const updater = makeUpdater({ currentCode: 2147483647 });
    const result = await updater.check({ force: true });
    check("kind === up-to-date", result.kind === "up-to-date", result.kind);
    await updater.close();
  }

  console.log("4. wrong selectors find no artifact");
  {
    // 这一项是故意复现 relkit 文档中 x64 / amd64 不一致造成的经典坑。
    const updater = makeUpdater({ clientSelectors: { os: "windows", arch: "amd64" } });
    const result = await updater.check({ force: true });
    const noArtifact =
      result.kind === "check-failed" ||
      (result.kind === "update-available" && !result.artifact);
    check("no artifact matches amd64", noArtifact, result.kind);
    await updater.close();
  }

  console.log("5. wrong trusted key is rejected");
  {
    const updater = makeUpdater({ trustedKeys: { "cronkit-2026": Buffer.alloc(32, 7) } });
    const result = await updater.check({ force: true });
    check("kind === check-failed", result.kind === "check-failed", result.kind);
    await updater.close();
  }

  console.log("6. wrong product is rejected");
  {
    const updater = makeUpdater({ product: "cronkitt" });
    const result = await updater.check({ force: true });
    check("kind === check-failed", result.kind === "check-failed", result.kind);
    await updater.close();
  }

  console.log("7. unreachable entry fails without crashing");
  {
    const updater = makeUpdater({
      entryUrls: [`http://127.0.0.1:${DEAD_PORT}/directory/cronkit.pb`],
    });
    const result = await updater.check({ force: true });
    check("kind === check-failed", result.kind === "check-failed", result.kind);
    check("no file left behind", statSync(staging).isDirectory(), "staging gone");
    await updater.close();
  }

  console.log("8. throttling holds without force");
  {
    const updater = makeUpdater();
    const first = await updater.check({ force: true });
    check("first check ran", first.kind !== "check-throttled", first.kind);
    const second = await updater.check();
    check("second check throttled", second.kind === "check-throttled", second.kind);
    await updater.close();
  }
} finally {
  server.close();
  rmSync(staging, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.log(`relkit smoke FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("relkit smoke PASSED");
