#!/usr/bin/env node
// relkit 跨实现闭环冒烟：用 lock 钉住的 relkit-updater sidecar 打真实 v2 protobuf。
//
// 用法：
//   node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port]
//
// port 必须与发布时 relkit.json 里 baseUrl 的端口完全一致（默认 18080）。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientProfileSchema,
  Placement,
  RuntimeSchema,
  UpdaterEventSchema,
  UpdaterRequestSchema,
} from "@relkit/updater-bindings/updater/v1";

const [rawPublishDir, publicKeyBase64, rawPort] = process.argv.slice(2);
if (!rawPublishDir || !publicKeyBase64) {
  console.error("usage: node scripts/relkit-smoke.mjs <publishDir> <publicKeyBase64> [port]");
  process.exit(1);
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sidecar = join(root, "tools", "bin", process.platform === "win32" ? "relkit-updater.exe" : "relkit-updater");
if (!existsSync(sidecar)) {
  console.error("missing tools/bin/relkit-updater; run python scripts/host/relkit_host.py install");
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
        keyId: "cronkit-2026",
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
      downloadReq.op = { case: "download", value: { planId } };
      const events = await runSidecar(frame(UpdaterRequestSchema, downloadReq));
      const downloaded = events.find((event) => event.kind.case === "download");
      check("download accepted", downloaded?.kind.case === "download", downloaded?.kind.case);
      if (downloaded?.kind.case === "download" && downloaded.kind.value.kind.case === "downloaded") {
        check("bytes > 0", Number(downloaded.kind.value.kind.value.bytes) > 0);
      }
      check("server saw a Range request", rangeRequests > 0, `rangeRequests=${rangeRequests}`);
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
