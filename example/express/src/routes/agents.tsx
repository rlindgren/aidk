/**
 * Agent Routes
 *
 * Execute and stream agent workflows via HTTP.
 * Using createExpressMiddleware for minimal boilerplate.
 */

import { getEngine } from "../setup";
import { agents } from "../agents";
import { createExpressMiddleware, getSSETransport } from "aidk-express";

export default createExpressMiddleware({
  engine: getEngine(),
  agents,
  transport: getSSETransport(),
});
