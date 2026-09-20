/**
 * 更新配置：编译期常量 + 运行期推导。
 *
 * 这里刻意不引入 Electron（守 ADR 0002），因此所有跟 `app` 相关的取值
 * 都通过参数传进来，由 `src/main/update.ts` 负责注入。
 */

import { APP_VERSION_CODE, APP_VERSION_FULL } from "../../generated/version";

/** relkit 侧的 product id，改名等于断更，禁止随意修改。 */
export const UPDATE_PRODUCT = "cronkit";

/** 默认通道。relkit.json 里同时登记了 dev，但客户端首版只走 stable。 */
export const UPDATE_CHANNEL = "stable";

/**
 * 签名 directory 的入口地址（SPEC §16）。
 *
 * 用 `raw.` 而不是 `updates.`：后者将来要让给索引站。这个值一旦随二进制发出去
 * 就几乎改不动了，因此禁止先用 COS 默认桶域名凑一版。
 */
export const UPDATE_ENTRY_URLS: readonly string[] = [
  "https://raw.firoyang.com/rup/directory/cronkit.pb",
];

/**
 * 内嵌的受信公钥（base64 的 32 字节 Ed25519 裸公钥）。
 *
 * 必须编译期内嵌，禁止运行时下载——否则验签形同虚设。轮换时先双钥并存发一版，
 * 等旧版基本消失后再删旧钥。
 */
export const UPDATE_TRUSTED_KEYS: Readonly<Record<string, string>> = {
  "cronkit-2026": "iDVCC4DBw1weJn8gl+D82ap3j+ueHV/OksSdlt2SGvk=",
};

/**
 * 客户端 selectors。
 *
 * 必须与发布侧 `relkit stage --add … os=windows,arch=x64` 逐字一致。
 * 用 `x64` 而非 `amd64`（对齐 SPEC §11.1）——写错的表现是「检查成功但找不到产物」，
 * 极难排查，冒烟脚本第 4 项就是专门复现这个坑。
 */
export const UPDATE_CLIENT_SELECTORS: Readonly<Record<string, string>> = {
  os: "windows",
  arch: "x64",
};

/**
 * 开发态用的 code：高于任何可能已发布的版本，因此永不触发更新（SPEC §8.1）。
 *
 * 绝不能用 0 —— 上报 0 的开发构建会把自己「更新」成正式版，把本地改动覆盖掉。
 */
export const DEV_CURRENT_CODE = 2147483647;

/** 当前构建的 code。未打包时返回开发态哨兵值。 */
export function resolveCurrentCode(isPackaged: boolean): number {
  return isPackaged ? APP_VERSION_CODE : DEV_CURRENT_CODE;
}

/** 展示给用户的版本号，例如 `0.1.0+1`。 */
export const CURRENT_VERSION_LABEL = APP_VERSION_FULL;
