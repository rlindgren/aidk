import { wrapHook } from "aidk-kernel";
import { telemetryMiddleware, errorMiddleware } from "../middleware/defaults";
import { getGlobalMiddleware } from "../config";

export const createEngineHook = wrapHook([
  telemetryMiddleware,
  errorMiddleware,
  ...(getGlobalMiddleware() || []),
]);
