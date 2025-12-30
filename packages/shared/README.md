# aidk-shared

Platform-independent type definitions and utilities for AIDK.

## Installation

```bash
pnpm add aidk-shared
```

> **Note:** This package is typically used internally by other AIDK packages. Most users don't need to install it directly.

## What's Included

- **Content Blocks** - Discriminated union types for all content types (text, images, tools, etc.)
- **Messages** - Role-based message types with type-safe content
- **Streaming Types** - Platform-independent streaming protocol definitions
- **Tool Types** - Tool calling interfaces and execution type classifications
- **Model Types** - Model input/output contracts
- **Testing Utilities** - Fixtures and helpers for testing AIDK applications

## Usage

```typescript
import { Message, ContentBlock, TextBlock, ToolUseBlock } from 'aidk-shared';
import { EngineStreamEvent, StopReason } from 'aidk-shared/streaming';
import { ToolExecutor } from 'aidk-shared/tools';

// Type-safe content blocks
const textBlock: TextBlock = { type: 'text', text: 'Hello' };
const toolBlock: ToolUseBlock = {
  type: 'tool_use',
  toolUseId: 'call_123',
  name: 'calculator',
  input: { expression: '2+2' }
};

// Messages with typed content
const message: Message = {
  role: 'assistant',
  content: [textBlock, toolBlock]
};
```

## Testing Utilities

```typescript
import {
  createUserMessage,
  createAssistantMessage,
  createToolUseBlock,
  createTextStreamSequence,
  captureAsyncGenerator,
  waitFor,
} from 'aidk-shared/testing';

// Create test fixtures
const msg = createUserMessage('Hello');
const toolBlock = createToolUseBlock({ name: 'search', input: { q: 'test' } });

// Capture async generator output
const events = await captureAsyncGenerator(stream);
```

## Documentation

See the [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed type hierarchies and design decisions.
