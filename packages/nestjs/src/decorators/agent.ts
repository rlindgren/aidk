import { SetMetadata } from "@nestjs/common";
import type { JSX } from "aidk/jsx-runtime";
import { ROOT_TOKEN } from "../tokens";

/**
 * Decorator to mark a route handler for streaming execution.
 * The handler should return EngineInput, and the root JSX will be provided via metadata.
 */
export function Stream(root?: JSX.Element) {
  return SetMetadata(ROOT_TOKEN, { type: "stream", root });
}

/**
 * Decorator to mark a route handler for execution.
 * The handler should return EngineInput, and the root JSX will be provided via metadata.
 */
export function Execute(root?: JSX.Element) {
  return SetMetadata(ROOT_TOKEN, { type: "execute", root });
}

/** @deprecated Use Stream instead */
export const StreamAgent = Stream;

/** @deprecated Use Execute instead */
export const ExecuteAgent = Execute;
