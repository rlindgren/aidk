import { type Express } from "express";
import agentsRouter from "./agents";
import channelsRouter from "./channels";
import executionsRouter from "./executions";
import todosRouter from "./todos";
import scratchpadRouter from "./scratchpad";

export const defineRoutes = (app: Express) => {
  app.use("/api/agents", agentsRouter);
  app.use("/api/channels", channelsRouter);
  app.use("/api/executions", executionsRouter);
  app.use("/api/tasks", todosRouter);
  app.use("/api/notes", scratchpadRouter);
};
