import { logger } from "./lib/logger";
import { runProductionPreflight } from "./preflight";

const rawPort = process.env["PORT"];

async function start(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    await runProductionPreflight();
  }

  const { default: app } = await import("./app");

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    void import("./lib/identityDeletion").then(({ startIdentityDeletionWorker }) => startIdentityDeletionWorker());
  });
}

void start().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "API server startup failed.";
  logger.error({ message }, "API server startup failed");
  process.exitCode = 1;
});
