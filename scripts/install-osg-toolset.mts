import {
  installOrUpdateToolset,
  listInstalledToolsets,
  rememberToolsetSha,
} from "../src/core/toolset/index.ts";

async function main(): Promise<void> {
  const info = await installOrUpdateToolset("osg");
  if (info.sha) {
    rememberToolsetSha("osg", info.sha);
  }
  console.log(JSON.stringify(info, null, 2));
  console.log(
    "all",
    listInstalledToolsets().map((t) => ({
      id: t.id,
      installed: t.installed,
      deps: t.depsReady,
      sha: t.sha,
      tools: t.tools.length,
    })),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
