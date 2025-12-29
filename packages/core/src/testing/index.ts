/**
 * # AIDK Testing
 *
 * Re-exports testing utilities from `aidk-shared/testing`.
 * Import from `aidk/testing` for convenience.
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
 *   captureAsyncGenerator,
 * } from 'aidk/testing';
 *
 * const messages = [
 *   createUserMessage('Hello'),
 *   createAssistantMessage('Hi there!'),
 * ];
 * ```
 *
 * @see aidk-shared/testing for full documentation
 *
 * @module aidk/testing
 */

export * from "aidk-shared/testing";
