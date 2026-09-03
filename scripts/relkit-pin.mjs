// relkit 上游固定点。rup-client（Node SDK）与 relkit-apply（更新 sidecar）都从这一个
// 提交构建，产物才不会随 relkit HEAD 漂移。
//
// 抬 ref 时要重新跑一次 `npm run dist` 并复核 sidecar 行为：它负责在客户端机器上原地
// 替换目录，回归的代价是用户装不上新版本。
export const RELKIT_URL = process.env.RELKIT_URL || "https://github.com/shichao402/relkit.git";
export const RELKIT_REF =
  process.env.RELKIT_REF || "f39d82009d5e2fcd90227d1bf8f90e37ae74d090";
export const RELKIT_DIR = "third_party/relkit";
