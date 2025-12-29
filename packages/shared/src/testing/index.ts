/**
 * # AIDK Testing Utilities
 *
 * Fixtures, mocks, and helpers for testing AIDK applications.
 * Import from `aidk-shared/testing` for test utilities.
 *
 * ## Features
 *
 * - **Fixtures** - Factory functions for messages, blocks, tools
 * - **Stream Helpers** - Create and capture async generators
 * - **SSE Utilities** - Parse and format Server-Sent Events
 * - **Mock Utilities** - Spies, mocks, and sequences
 *
 * ## Quick Start
 *
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
 *
 * @module aidk-shared/testing
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
