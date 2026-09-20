import { Buffer } from "node:buffer";
import { create } from "@bufbuild/protobuf";
import {
  ClientProfileSchema,
  Placement,
  RuntimeSchema,
  type ClientProfile,
  type Runtime,
} from "@relkit/updater-bindings/updater/v1";
import { resolveInstallDir, UPDATE_EXECUTABLE, UPDATE_RETAIN_VERSIONS, UPDATE_SIDECAR } from "./apply";
import {
  UPDATE_CHANNEL,
  UPDATE_CLIENT_SELECTORS,
  UPDATE_ENTRY_URLS,
  UPDATE_PRODUCT,
  UPDATE_TRUSTED_KEYS,
  resolveCurrentCode,
} from "./config";

export function buildClientProfile(): ClientProfile {
  return create(ClientProfileSchema, {
    product: UPDATE_PRODUCT,
    allowedChannels: ["stable", "dev"],
    entryUrls: [...UPDATE_ENTRY_URLS],
    trustedKeys: Object.entries(UPDATE_TRUSTED_KEYS).map(([keyId, publicKeyBase64]) => ({
      keyId,
      publicKey: Uint8Array.from(Buffer.from(publicKeyBase64, "base64")),
    })),
  });
}

export function buildRuntime(options: {
  isPackaged: boolean;
  executablePath: string;
  dataDir: string;
  sidecarPath?: string;
}): Runtime {
  const installRoot = resolveInstallDir(options.executablePath);
  return create(RuntimeSchema, {
    channel: UPDATE_CHANNEL,
    currentCode: BigInt(resolveCurrentCode(options.isPackaged)),
    clientSelectors: { ...UPDATE_CLIENT_SELECTORS },
    dataDir: options.dataDir,
    sidecarPath: options.sidecarPath ?? "",
    install: {
      placement: Placement.LIBRARY,
      installRoot,
      executableRelpath: UPDATE_EXECUTABLE,
      sidecarRelpath: UPDATE_SIDECAR,
      relaunch: true,
      library: { retain: UPDATE_RETAIN_VERSIONS },
    },
  });
}
