/**
 * # AIDK Server Client
 *
 * Direct engine access for server-side use. Same interface as frontend
 * clients but without HTTP overhead.
 *
 * ## Features
 *
 * - **Direct Execution** - Call engine without HTTP
 * - **Message Normalization** - Convert various input formats
 * - **Type Safety** - Full TypeScript support
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createServerClient } from 'aidk/client';
 *
 * const client = createServerClient({ engine });
 *
 * const result = await client.execute({
 *   agentId: 'my-agent',
 *   input: 'Hello!',
 * });
 * ```
 *
 * @module aidk/client
 */

export {
  ServerClient,
  createServerClient,
  type ServerClientConfig,
  type ExecuteOptions,
} from "./server-client";

export {
  type MessageInput,
  type ContentInput,
  type ContentInputArray,
  normalizeMessageInput,
  normalizeContentArray,
  normalizeContentInput,
  messagesToTimeline,
  isMessage,
  isContentBlock,
} from "./types";
