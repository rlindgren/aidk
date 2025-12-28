/**
 * AIDK Test Utilities
 *
 * Provides fixtures, mocks, and helpers for testing AIDK applications.
 *
 * @example
 * ```typescript
 * import {
 *   createUserMessage,
 *   createAssistantMessage,
 *   createTextStreamSequence,
 *   captureAsyncGenerator,
 *   waitForEvent,
 * } from 'aidk-shared/testing';
 *
 * // Create test fixtures
 * const messages = [
 *   createUserMessage('Hello'),
 *   createAssistantMessage('Hi there!'),
 * ];
 *
 * // Create stream sequences
 * const chunks = createTextStreamSequence('Hello world');
 *
 * // Capture async generator output
 * const items = await captureAsyncGenerator(myStream());
 * ```
 */

// Fixtures - factory functions for test data
export {
  // ID utilities
  testId,
  resetTestIds,
  // Content blocks
  createTextBlock,
  createImageBlock,
  createBase64ImageBlock,
  createToolUseBlock,
  createToolResultBlock,
  createErrorToolResultBlock,
  createReasoningBlock,
  createCodeBlock,
  // Messages
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
  createConversation,
  // Tools
  createToolDefinition,
  createAgentToolCall,
  createAgentToolResult,
  // Stream chunks
  createStreamChunk,
  createTextDeltaChunk,
  createMessageStartChunk,
  createMessageEndChunk,
  createToolCallChunk,
  createToolResultChunk,
  createTextStreamSequence,
  createToolCallStreamSequence,
} from "./fixtures";

// Helpers - async utilities and test helpers
export {
  // Async utilities
  waitForEvent,
  waitForEvents,
  waitFor,
  sleep,
  createDeferred,
  // Stream utilities
  captureAsyncGenerator,
  arrayToAsyncGenerator,
  createControllableGenerator,
  // SSE utilities
  parseSSEEvent,
  parseSSEBuffer,
  formatSSEEvent,
  // Mock utilities
  createSpy,
  createMock,
  createMockSequence,
} from "./helpers";
