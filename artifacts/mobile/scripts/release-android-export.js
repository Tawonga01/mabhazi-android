const { spawnSync } = require("child_process");
const { runReleasePreflight } = require("./release-preflight");

const resolved = runReleasePreflight(process.env);
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "expo",
    "export",
    "--platform",
    "android",
    "--output-dir",
    "dist/android",
  ],
  {
    cwd: require("path").resolve(__dirname, ".."),
    env: {
      ...process.env,
      ...resolved,
      EXPO_PUBLIC_DOMAIN:
        new URL(resolved.EXPO_PUBLIC_API_BASE_URL).host,
    },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;