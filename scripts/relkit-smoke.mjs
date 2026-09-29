#!/usr/bin/env node
// relkit 跨实现闭环冒烟：用 lock 钉住的 relkit-updater sidecar 打真实 v2 protobuf。
//
// 两种形态，显式声明，互不等价、无隐式回退：
//
//   directory-only  本地只伺服 directory 层，index/manifest/产物全部由线上
//                   serve 承载（directory.pb 里的 URL 指向真实线上端点）。
//                   验证的是真实发布平面的端到端链路。产物下载（含 Range
//                   续传）发生在远端，本地观测点看不到 Range 请求，因此
//                   Range 断言在此形态下不适用，不输出 Range 观测信息。
//
//   full-tree       本地伺服完整产物树（directory + index + manifest + 产物，
//                   directory.pb 里的 URL 指向 http://127.0.0.1:<port>）。产物
//                   下载打到本地，因此此形态硬断言 range_requests >= 1：这是
//                   「分段续传路径被执行」的唯一本地证据点。
//
// 用法：
//   node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port] [mode]
//
//   mode = directory-only | full-tree（默认 directory-only）
//
//   port（默认 18080）：
//     full-tree      必须与发布时 baseUrl 的端口逐字一致——directory.pb 内
//                    的 URL 在 publish 时已按 baseUrl 固化，端口不符会表现
//                    为 check-failed（SPEC §1.1 禁止客户端自行拼 URL）。
//     directory-only 本地端口可任选——本地只伺服 directory 层，其余 URL
//                    全部指向线上 serve，与本地端口无关。
//
//   full-tree 形态的 publishDir 要求（用 relkit CLI + 本地 relkit-store 产出）：
//     directory/cronkit.pb 内 indexUrl 与 manifest 内产物 URL 都指向
//     http://127.0.0.1:<port>（发布时 baseUrl 即该端口），index/、manifest/、
//     artifact/ 全套产物在树内。产出流程（一次性演练，产物树不入库）：
//       1) relkit keygen --key-id <演练key> --out <dir>
//       2) 写演练 relkit.json：backends 加 relkit-compatible 指向
//          http://127.0.0.1:<port>，signing 用演练 key
//       3) relkit-store -dir <storeRoot> -addr 127.0.0.1:<port> -token-file …
//       4) relkit stage --install … --payload … && relkit publish <ver> --to <backend>
//          && relkit directory set --from-config --to <backend>
//       5) 停掉 relkit-store（释放端口），本脚本接管 <port> 伺服 <storeRoot>
//     注意：脚本与 relkit-store 不能同时占同一端口；URL 在 publish 时已按
//     baseUrl 固化进签名文档，故脚本伺服同一目录即可闭环。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientProfileSchema,
  DownloadOpSchema,
  Placement,
  RuntimeSchema,
  UpdaterEventSchema,
  UpdaterRequestSchema,
} from "@relkit/updater-bindings/updater/v1";

const [rawPublishDir, publicKeyBase64, rawPort, rawMode] = process.argv.slice(2);
const MODES = ["directory-only", "full-tree"];
if (!rawPublishDir || !publicKeyBase64 || (rawMode !== undefined && !MODES.includes(rawMode))) {
  console.error(
    "usage: node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port] [mode]",
  );
  console.error(`  mode = ${MODES.join(" | ")} (default: directory-only)`);
  process.exit(1);
}
const mode = rawMode ?? "directory-only";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sidecar = join(root, "tools", "bin", process.platform === "win32" ? "relkit-updater.exe" : "relkit-updater");
if (!existsSync(sidecar)) {
  console.error("missing tools/bin/relkit-updater; run go run github.com/shichao402/relkit/cmd/relkit@v0.5.9 install");
  process.exit(1);
}

const publishDir = resolve(rawPublishDir);
const PORT = Number(rawPort ?? 18080);
const DEAD_PORT = PORT + 1;
const MAX_FRAME = 32 << 20;

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

function frame(schema, message) {
  const payload = toBinary(schema, message);
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.set(payload, 4);
  return out;
}

// ---- Envelope (rup.envelope/2) wire 解码，只为取 signatures[].key_id ----
// directory.pb 顶层：1=schema(string) 2=payload(bytes) 3=signatures(message)，
// Signature 内：1=key_id(string) 2=alg(string) 3=sig(bytes)。不做完整解析，
// 只走 varint/len-delimited 读出第一个 key_id，无第三方依赖。
function readVarint(buf, pos) {
  let value = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos];
    value |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) return [value, pos];
    shift += 7n;
  }
  throw new Error("truncated varint");
}

function readTag(buf, pos) {
  const [key, next] = readVarint(buf, pos);
  return [Number(key >> 3n), Number(key & 7n), next];
}

function envelopeSignerKeyId(bytes) {
  let pos = 0;
  while (pos < bytes.length) {
    const [field, wire, next] = readTag(bytes, pos);
    pos = next;
    if (wire !== 2) {
      // schema(1)/payload(2)/signatures(3) 全是 len-delimited；未知 wire 跳过
      const [, skipTo] = wire === 0 ? readVarint(bytes, pos) : [0, pos + 8];
      pos = wire === 0 ? skipTo : wire === 5 ? pos + 4 : pos + 8;
      continue;
    }
    const [len, lenEnd] = readVarint(bytes, pos);
    pos = lenEnd;
    const end = pos + Number(len);
    if (field === 3) {
      // Signature 消息：找 key_id(field 1, string)
      let spos = pos;
      while (spos < end) {
        const [sfield, swire, snext] = readTag(bytes, spos);
        spos = snext;
        if (swire !== 2) {
          const [, svEnd] = swire === 0 ? readVarint(bytes, spos) : [0, spos];
          spos = swire === 0 ? svEnd : swire === 5 ? spos + 4 : spos + 8;
          continue;
        }
        const [slen, slenEnd] = readVarint(bytes, spos);
        spos = slenEnd;
        if (sfield === 1) {
          return bytes.subarray(spos, spos + Number(slen)).toString("utf8");
        }
        spos += Number(slen);
      }
    }
    pos = end;
  }
  throw new Error("no signature in envelope");
}

const directoryBytes = readFileSync(join(publishDir, "directory", "cronkit.pb"));
const signerKeyId = envelopeSignerKeyId(directoryBytes);

async function runSidecar(stdinBytes) {
  const child = spawn(sidecar, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const events = [];
  let pending = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const size = pending.readUInt32BE(0);
        if (size > MAX_FRAME || pending.length < 4 + size) {
          break;
        }
        events.push(fromBinary(UpdaterEventSchema, pending.subarray(4, 4 + size)));
        pending = Buffer.from(pending.subarray(4 + size));
      }
    });
    child.stdout.on("end", resolve);
    child.stderr?.resume();
    if (stdinBytes.length) {
      child.stdin.write(stdinBytes);
    }
    child.stdin.end();
  });
  return events;
}

function makeRequest(overrides = {}) {
  const profile = create(ClientProfileSchema, {
    product: overrides.product ?? "cronkit",
    allowedChannels: ["stable"],
    entryUrls: overrides.entryUrls ?? [`${base}/directory/cronkit.pb`],
    trustedKeys: [
      {
        keyId: overrides.keyId ?? signerKeyId,
        publicKey: Uint8Array.from(Buffer.from(overrides.publicKeyBase64 ?? publicKeyBase64, "base64")),
      },
    ],
  });
  const runtime = create(RuntimeSchema, {
    channel: "stable",
    currentCode: BigInt(overrides.currentCode ?? 0),
    clientSelectors: overrides.clientSelectors ?? { os: "windows", arch: "x64" },
    dataDir: staging,
    sidecarPath: sidecar,
    install: {
      placement: Placement.LIBRARY,
      installRoot: staging,
      executableRelpath: "WorkspaceOrchestrator.exe",
      sidecarRelpath: "relkit-updater.exe",
      relaunch: false,
      library: { retain: 2 },
    },
  });
  return create(UpdaterRequestSchema, {
    hello: { ipcMin: 3, ipcMax: 3 },
    profile,
    runtime,
    op: { case: "check", value: { force: overrides.force ?? true } },
  });
}

async function checkOp(overrides = {}) {
  const events = await runSidecar(frame(UpdaterRequestSchema, makeRequest(overrides)));
  const checkEvent = events.find((event) => event.kind.case === "check");
  return checkEvent?.kind.case === "check" ? checkEvent.kind.value : undefined;
}

console.log(`mode: ${mode} (directory signed by ${signerKeyId})`);
try {
  console.log("1. fresh install sees the release");
  {
    const result = await checkOp();
    check("kind === updateAvailable", result?.kind.case === "updateAvailable", result?.kind.case);
    if (result?.kind.case === "updateAvailable") {
      check("code > 0", Number(result.kind.value.code) > 0, String(result.kind.value.code));
      check("artifact selected", result.kind.value.artifacts.length > 0, "no artifact");
      const planId = result.kind.value.planId;
      console.log("2. download passes size + sha256");
      const downloadReq = makeRequest();
      downloadReq.op = { case: "download", value: create(DownloadOpSchema, { planId }) };
      const events = await runSidecar(frame(UpdaterRequestSchema, downloadReq));
      const downloaded = events.find((event) => event.kind.case === "download");
      check("download accepted", downloaded?.kind.case === "download", downloaded?.kind.case);
      if (downloaded?.kind.case === "download" && downloaded.kind.value.kind.case === "downloaded") {
        check("bytes > 0", Number(downloaded.kind.value.kind.value.bytes) > 0);
      }
      // Range 请求打到产物所在的 serve 端点。directory-only 形态下产物
      // 下载发生在远端，本地观测点不应收到 Range 请求，收到了反而是
      // 接线错误（directory 指向了本地）；full-tree 形态下产物下载打
      // 本地，Range 请求 >= 1 是「分段续传路径被执行」的硬性证据。
      if (mode === "full-tree") {
        check("local server saw >= 1 Range request", rangeRequests >= 1, `saw ${rangeRequests}`);
      } else {
        check("directory-only: local server saw 0 Range request", rangeRequests === 0, `saw ${rangeRequests}`);
      }
    }
  }

  console.log("3. already-current client is up to date");
  {
    const result = await checkOp({ currentCode: 2147483647 });
    check("kind === upToDate", result?.kind.case === "upToDate", result?.kind.case);
  }

  console.log("4. wrong selectors find no artifact");
  {
    const result = await checkOp({ clientSelectors: { os: "windows", arch: "amd64" } });
    const noArtifact =
      result?.kind.case === "failed" ||
      (result?.kind.case === "updateAvailable" && result.kind.value.artifacts.length === 0);
    check("no artifact matches amd64", Boolean(noArtifact), result?.kind.case);
  }

  console.log("5. wrong trusted key is rejected");
  {
    const result = await checkOp({ publicKeyBase64: Buffer.alloc(32, 7).toString("base64") });
    check("kind === failed", result?.kind.case === "failed", result?.kind.case);
  }

  console.log("6. wrong product is rejected");
  {
    const result = await checkOp({ product: "cronkitt" });
    check("kind === failed", result?.kind.case === "failed", result?.kind.case);
  }

  console.log("7. unreachable entry fails without crashing");
  {
    const result = await checkOp({
      entryUrls: [`http://127.0.0.1:${DEAD_PORT}/directory/cronkit.pb`],
    });
    check("kind === failed", result?.kind.case === "failed", result?.kind.case);
    check("no crash", statSync(staging).isDirectory());
  }

  console.log("8. throttling holds without force");
  {
    const first = await checkOp({ force: true });
    check("first check ran", first?.kind.case !== "throttled", first?.kind.case);
    const second = await checkOp({ force: false });
    check("second check throttled", second?.kind.case === "throttled", second?.kind.case);
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
