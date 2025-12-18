# API Reference

Complete API documentation for all AIDK packages.

## Core Packages

### aidk

The core framework package.

- [Engine](./core/engine.md) - Execution orchestrator
- [Components](./core/components.md) - JSX components
- [Tools](./core/tools.md) - Tool creation
- [Context](./core/context.md) - Execution context
- [Types](./core/types.md) - TypeScript types

### aidk-kernel

Low-level execution primitives.

- [Execution](./kernel/execution.md) - Execution helpers
- [Context](./kernel/context.md) - Context management
- [Telemetry](./kernel/telemetry.md) - Tracing & metrics
- [Logger](./kernel/logger.md) - Structured logging

## Client Packages

### aidk-client

Browser client for AIDK backends.

- [EngineClient](./client/engine-client.md) - Main client class
- [ExecutionHandler](./client/execution-handler.md) - Stream handling
- [Channels](./client/channels.md) - Real-time subscriptions
- [Types](./client/types.md) - Client types

## Server Packages

### aidk-express

Express.js integration.

- [Middleware](./express/middleware.md) - Express middleware
- [SSE Transport](./express/sse.md) - Server-sent events

### aidk-nestjs

NestJS integration.

- [EngineModule](./nestjs/module.md) - NestJS module setup
- [Decorators](./nestjs/decorators.md) - Agent decorators
- [Interceptors](./nestjs/interceptors.md) - Context interceptors
- [Guards](./nestjs/guards.md) - Context guards
- [SSE Transport](./nestjs/sse.md) - Server-sent events

### aidk-server

Server utilities.

- [Channel Server](./server/channels.md) - Channel broadcasting
- [Adapters](./server/adapters.md) - Storage adapters

## Framework Bindings

### aidk-react

React hooks and components.

- [useEngineClient](./react/use-engine-client.md) - Client hook
- [useExecution](./react/use-execution.md) - Execution hook
- [Components](./react/components.md) - UI components

### aidk-angular

Angular services and components.

- [EngineService](./angular/engine-service.md) - Client service
- [ExecutionService](./angular/execution-service.md) - Execution service
- [ChannelsService](./angular/channels-service.md) - Channel service
- [Components](./angular/components.md) - UI components

## Adapters

### aidk-ai-sdk

Vercel AI SDK adapter.

- [AiSdkModel](./adapters/ai-sdk.md) - Model component

### aidk-openai

OpenAI direct adapter.

- [OpenAIModel](./adapters/openai.md) - Model component

### aidk-google

Google AI adapter.

- [GoogleModel](./adapters/google.md) - Model component

