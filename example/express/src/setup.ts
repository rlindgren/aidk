import { createEngine, Engine, EngineContext, Logger } from "aidk";
import { attachDevTools } from "aidk-devtools";
import { getStore } from "./persistence/database";
import {
  getExecutionRepository,
  getMetricsRepository,
  getMessageRepository,
  getMessageBlockRepository,
  getInteractionRepository,
  getToolStateRepository,
} from "./persistence/repositories";
import { setupPersistenceHooks } from "./persistence/hooks";
import { channels } from "./channels";

let engineInstance: Engine | null = null;
let detachDevTools: (() => void) | null = null;

export function setupEngine() {
  // Configure logger with app-specific context fields
  Logger.configure({
    level: (process.env["LOG_LEVEL"] as "debug" | "info" | "warn" | "error") || "info",
    contextFields: (ctx: EngineContext) => ({
      // App-specific fields (defaults like request_id, trace_id are auto-included)
      userId: ctx.user?.id,
      tenantId: ctx.user?.tenantId,
      threadId: ctx.metadata?.threadId,
      executionId: ctx.metadata?.executionId,
      tick: ctx.metadata?.tick,
      agent: ctx.metadata?.agent,
    }),
  });

  // Initialize in-memory store
  getStore();

  // Setup persistence hooks
  setupPersistenceHooks(getRepositories());

  // Create engine with channel service configured for SSE transport
  getEngine();
}

export function getEngine(): Engine {
  if (engineInstance) {
    return engineInstance;
  }

  // Create engine with channel service configured for SSE transport
  engineInstance = createEngine({ channels });

  // Attach devtools if DEVTOOLS env var is set
  if (process.env["DEVTOOLS"] === "true" || process.env["DEVTOOLS"] === "1") {
    detachDevTools = attachDevTools(engineInstance, {
      port: +(process.env["DEVTOOLS_PORT"] || 3004),
      open: process.env["DEVTOOLS_OPEN"] !== "false",
      debug: process.env["DEVTOOLS_DEBUG"] === "true",
    });
  }

  return engineInstance;
}

export function getRepositories() {
  return {
    executionRepo: getExecutionRepository(),
    metricsRepo: getMetricsRepository(),
    messageRepo: getMessageRepository(),
    messageBlockRepo: getMessageBlockRepository(),
    interactionRepo: getInteractionRepository(),
    toolStateRepo: getToolStateRepository(),
  };
}

export function stopDevToolsServer() {
  if (detachDevTools) {
    detachDevTools();
    detachDevTools = null;
  }
}
