import { createEngine, Engine, EngineContext, Logger } from "aidk";
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
