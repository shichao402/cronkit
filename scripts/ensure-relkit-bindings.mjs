#!/usr/bin/env node
/**
 * npm 依赖指向 lock 装进来的 bindings-ts。没有它时失败，而不是再稀疏检出
 * 整份 relkit 去编 rup-client。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindings = path.join(root, "third_party", "relkit", "bindings", "ts", "package.json");
if (!existsSync(bindings)) {
  console.error(
    "缺少 lock 钉住的 @relkit/updater-bindings。先运行：\n" +
      "  python scripts/host/relkit_host.py install",
  );
  process.exit(1);
}
