import express from "express";
import cors from "cors";
import { Logger } from "aidk";
import { defineRoutes } from "./routes";

import { getEngine, setupEngine, stopDevToolsServer } from "./setup";

const app = express();
const PORT = +(process.env["PORT"] || 3000);

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Initialize engine on startup (also configures Logger)
setupEngine();

const log = Logger.for("Server");

// Routes
defineRoutes(app);

const server = app.listen(PORT, () => {
  log.info({ port: PORT }, "Server started");
  log.info({ url: `http://localhost:${PORT}/health` }, "Health check endpoint");
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

async function gracefulShutdown(signal: string) {
  log.info({ signal }, "Shutdown signal received");

  // Stop devtools server
  stopDevToolsServer();

  // Cleanup engine resources (channels, executions, lifecycle hooks)
  getEngine().destroy();

  // Close HTTP server
  server.close((err) => {
    if (err) {
      log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
    log.info("Server closed");
    process.exit(0);
  });

  // Force close after timeout
  setTimeout(() => {
    log.error("Forced shutdown after timeout");
    process.exit(1);
  }, 5000);
}

// HMR-safe signal handlers: remove only our previous handlers, not others
const HANDLER_KEY = Symbol.for("aidk.server.shutdownHandlers");
const previousHandlers = (globalThis as any)[HANDLER_KEY] as
  | { sigterm?: () => void; sigint?: () => void }
  | undefined;

if (previousHandlers?.sigterm) process.removeListener("SIGTERM", previousHandlers.sigterm);
if (previousHandlers?.sigint) process.removeListener("SIGINT", previousHandlers.sigint);

const handlers = {
  sigterm: () => gracefulShutdown("SIGTERM"),
  sigint: () => gracefulShutdown("SIGINT"),
};
(globalThis as any)[HANDLER_KEY] = handlers;

process.once("SIGTERM", handlers.sigterm);
process.once("SIGINT", handlers.sigint);
