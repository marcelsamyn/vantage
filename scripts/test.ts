import { privateEnabled } from "./registry";

const result = Bun.spawnSync(["bun", "test", "./app", "./plugins", "./server", "./shared", ...(privateEnabled() ? ["./private"] : []), ...process.argv.slice(2)], {
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exit(result.exitCode);
