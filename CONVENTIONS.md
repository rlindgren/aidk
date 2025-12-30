# AIDK Naming Conventions

This document defines the naming conventions for the AIDK codebase.

---

## Core Principle

**All property names, identifiers, and API surfaces use camelCase.**

AIDK is a JavaScript/TypeScript library. We follow JavaScript conventions throughout, providing a consistent and ergonomic developer experience.

---

## Rules

### 1. Property Names: camelCase

All object properties use camelCase:

```typescript
// Correct
interface Message {
  id: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
}

interface ToolUseBlock {
  type: "tool_use";
  toolUseId: string;
  name: string;
  input: unknown;
}

interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: ContentBlock[];
  isError?: boolean;
  executedBy?: "client" | "server";
}

// Incorrect
interface Message {
  threadId: string; // No
  createdAt: string; // No
}
```

### 2. Block Type Values: snake_case (Exception)

Block type discriminator _values_ use snake_case to match LLM provider vocabulary:

```typescript
// These are string VALUES, not property names
type BlockType =
  | "text"
  | "image"
  | "tool_use" // Matches Anthropic/OpenAI
  | "tool_result" // Matches Anthropic/OpenAI
  | "reasoning"
  | "user_action"
  | "system_event"
  | "state_change";

// Usage
if (block.type === "tool_use") {
  console.log(block.toolUseId); // Property is camelCase
}
```

### 3. Event Type Values: snake_case (Exception)

Event type discriminator _values_ use snake_case for consistency with block types:

```typescript
type EventType =
  | "execution_start"
  | "execution_end"
  | "tick_start"
  | "tick_end"
  | "content_delta"
  | "reasoning_delta"
  | "tool_call"
  | "tool_result"
  | "engine_error";

// Usage
if (event.type === "execution_start") {
  console.log(event.executionId); // Property is camelCase
}
```

### 4. Type/Interface Names: PascalCase

All type and interface names use PascalCase:

```typescript
// Correct
interface ExecutionContext {}
interface ToolDefinition {}
type ContentBlock = TextBlock | ImageBlock | ToolUseBlock;

// Incorrect
interface execution_context {} // No
interface toolDefinition {} // No
```

### 5. Function/Method Names: camelCase

All functions and methods use camelCase:

```typescript
// Correct
function createEngine() {}
function handleToolResult() {}
class Engine {
  execute() {}
  getThreadId() {}
}

// Incorrect
function create_engine() {} // No
```

### 6. Constants: SCREAMING_SNAKE_CASE or camelCase

Module-level constants may use either:

```typescript
// Both acceptable
const MAX_RETRIES = 3;
const defaultTimeout = 30000;

// Exported constants prefer SCREAMING_SNAKE_CASE
export const DEFAULT_MODEL = "gpt-4";
```

### 7. Enum Values: Context-Dependent

```typescript
// PascalCase for semantic enums
enum StopReason {
  Stop = "stop",
  MaxTokens = "max_tokens",
  ToolUse = "tool_use",
}

// String values may be snake_case to match external APIs
```

---

## Identifier Naming

Common identifiers and their correct casing:

| Concept       | Correct        | Incorrect       |
| ------------- | -------------- | --------------- |
| Thread ID     | `threadId`     | `thread_id`     |
| User ID       | `userId`       | `user_id`       |
| Tenant ID     | `tenantId`     | `tenant_id`     |
| Session ID    | `sessionId`    | `session_id`    |
| Execution ID  | `executionId`  | `execution_id`  |
| Tool Use ID   | `toolUseId`    | `tool_use_id`   |
| Message ID    | `messageId`    | `message_id`    |
| Created At    | `createdAt`    | `created_at`    |
| Updated At    | `updatedAt`    | `updated_at`    |
| Input Tokens  | `inputTokens`  | `input_tokens`  |
| Output Tokens | `outputTokens` | `output_tokens` |
| Max Tokens    | `maxTokens`    | `max_tokens`    |
| Mime Type     | `mimeType`     | `mime_type`     |
| Alt Text      | `altText`      | `alt_text`      |
| Is Error      | `isError`      | `is_error`      |
| Executed By   | `executedBy`   | `executed_by`   |

---

## Wire Protocol

AIDK controls both client and server packages. All JSON transferred between them uses camelCase:

```typescript
// SSE event
{
  "type": "execution_start",  // Event type VALUE is snake_case
  "executionId": "exec_123",  // Property is camelCase
  "threadId": "thread_456",
  "sessionId": "sess_789"
}

// Tool result
{
  "type": "tool_result",      // Block type VALUE is snake_case
  "toolUseId": "call_abc",    // Property is camelCase
  "content": [...],
  "isError": false
}
```

---

## External API Boundaries

### LLM Provider Adapters

Adapters (OpenAI, Google, AI-SDK) handle transformation between AIDK's camelCase format and provider-specific formats:

```typescript
// AIDK internal (camelCase)
const input: ModelInput = {
  messages: [...],
  maxTokens: 1000,
  toolChoice: 'auto',
};

// Adapter transforms to provider format (snake_case for OpenAI)
// {
//   messages: [...],
//   max_tokens: 1000,
//   tool_choice: 'auto',
// }
```

### User Persistence

AIDK does not handle persistence. If users persist to a database with snake_case conventions, they handle that transformation in their application layer.

---

## Migration from snake_case

When updating existing code:

1. **Properties**: `thread_id` → `threadId`
2. **Block type values**: Keep as `'tool_use'`, `'tool_result'`
3. **Event type values**: Keep as `'execution_start'`, `'execution_end'`

---

## Rationale

1. **JavaScript Convention**: camelCase is the universal JavaScript/TypeScript convention
2. **Developer Ergonomics**: Feels natural to JS developers
3. **Library Control**: We control both client and server packages
4. **Adapter Isolation**: Provider-specific formats are handled in adapters
5. **No Persistence Opinion**: Application layer handles database conventions

---

_Established: 2024-12-27_
