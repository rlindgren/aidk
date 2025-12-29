# API Reference

::: warning Alpha Software
AIDK is currently in **alpha** (v0.1.x). APIs may change between releases. We recommend pinning to exact versions until 1.0.
:::

Welcome to the AIDK API Reference. This documentation is auto-generated from source code and provides detailed information about all packages, classes, functions, and types.

## Packages Overview

### Core Framework

| Package                          | Description                                           | Install             |
| -------------------------------- | ----------------------------------------------------- | ------------------- |
| [aidk](/api/aidk/)               | Main framework - Engine, Components, Hooks, Tools     | `npm i aidk`        |
| [aidk-kernel](/api/aidk-kernel/) | Low-level primitives - Procedures, Context, Telemetry | `npm i aidk-kernel` |
| [aidk-shared](/api/aidk-shared/) | Shared types - Messages, Blocks, Errors               | `npm i aidk-shared` |

### Client Libraries

| Package                            | Description                               | Install              |
| ---------------------------------- | ----------------------------------------- | -------------------- |
| [aidk-client](/api/aidk-client/)   | Browser client - SSE, Channels, Execution | `npm i aidk-client`  |
| [aidk-react](/api/aidk-react/)     | React hooks and components                | `npm i aidk-react`   |
| [aidk-angular](/api/aidk-angular/) | Angular services and modules              | `npm i aidk-angular` |

### Server Frameworks

| Package                            | Description                      | Install              |
| ---------------------------------- | -------------------------------- | -------------------- |
| [aidk-express](/api/aidk-express/) | Express.js middleware            | `npm i aidk-express` |
| [aidk-nestjs](/api/aidk-nestjs/)   | NestJS module and decorators     | `npm i aidk-nestjs`  |
| [aidk-server](/api/aidk-server/)   | Server utilities and persistence | `npm i aidk-server`  |

### Provider Adapters

| Package                          | Description              | Install             |
| -------------------------------- | ------------------------ | ------------------- |
| [aidk-openai](/api/aidk-openai/) | OpenAI native adapter    | `npm i aidk-openai` |
| [aidk-google](/api/aidk-google/) | Google AI native adapter | `npm i aidk-google` |

### Library Adapters

| Package                          | Description               | Install             |
| -------------------------------- | ------------------------- | ------------------- |
| [aidk-ai-sdk](/api/aidk-ai-sdk/) | Vercel AI SDK integration | `npm i aidk-ai-sdk` |

## Quick Navigation

### By Concept

- **Execution**: [Engine](/api/aidk/engine/classes/Engine.md), [ExecutionHandle](/api/aidk/engine/interfaces/ExecutionHandle.md)
- **Components**: [Component](/api/aidk/component/classes/Component.md), [JSX](/api/aidk/jsx/namespaces/JSX/)
- **State**: [signal](/api/aidk/state/functions/signal.md), [computed](/api/aidk/state/functions/computed.md), [effect](/api/aidk/state/functions/effect.md)
- **Tools**: [createTool](/api/aidk/tool/functions/createTool.md), [ToolDefinition](/api/aidk-shared/interfaces/ToolDefinition.md)
- **Messages**: [Message](/api/aidk-shared/interfaces/Message.md), [ContentBlock](/api/aidk-shared/type-aliases/ContentBlock.md)
- **Channels**: [ChannelService](/api/aidk/channels/classes/ChannelService.md)

### Most Used APIs

| API              | Description                    |
| ---------------- | ------------------------------ |
| `Engine`         | Main execution orchestrator    |
| `createTool()`   | Create type-safe tools         |
| `createModel()`  | Create model adapters          |
| `signal()`       | Create reactive state          |
| `useExecution()` | React hook for agent execution |

## TypeScript Support

All packages include full TypeScript definitions. Import types directly:

```typescript
import type { Message, ContentBlock, ToolDefinition, EngineConfig } from "aidk";
```
