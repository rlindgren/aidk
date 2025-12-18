/**
 * Server Client
 * 
 * Direct engine access for server-side use. Same interface as frontend
 * clients but without HTTP overhead.
 */

export { 
  ServerClient, 
  createServerClient,
  type ServerClientConfig,
  type ExecuteOptions,
} from './server-client';

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
} from './types';
