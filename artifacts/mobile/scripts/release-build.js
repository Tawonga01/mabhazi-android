const path = require("path");
const { spawnSync } = require("child_process");
const { runReleasePreflight } = require("./release-preflight");

const resolved = runReleasePreflight(process.env);
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "build.js")],
  {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ...resolved },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;