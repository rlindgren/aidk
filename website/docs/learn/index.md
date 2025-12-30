# Learn AIDK

A progressive tutorial series that takes you from first agent to advanced patterns.

## The Learning Path

### 1. Quick Start

Get your first agent running in 5 minutes.
→ [Quick Start Guide](/docs/getting-started)

### 2. Understanding Ticks

The core concept that makes AIDK different. Learn how the tick loop works and why your code runs between model calls.
→ [Understanding Ticks](./understanding-ticks)

### 3. Tools as Components

Discover that tools aren't just functions—they're full components with lifecycle, state, and rendering.
→ [Tools as Components](./tools-as-components)

### 4. Reactive State

Master signals, COM state, and reactive patterns for building dynamic agents.
→ [Reactive State](./reactive-state)

### 5. Dynamic Models

Switch models mid-conversation based on complexity, cost, or capability needs.
→ [Dynamic Models](./dynamic-models)

### 6. Parallel Agents

Use Fork and Spawn for multi-agent coordination and background processing.
→ [Parallel Agents](./parallel-agents)

## Key Concepts

Before diving in, understand these fundamentals:

| Concept            | What It Is                                                           |
| ------------------ | -------------------------------------------------------------------- |
| **Tick**           | One cycle of compile → model → tools → state                         |
| **COM**            | Context Object Model - the shared state tree                         |
| **Signal**         | Reactive state that triggers recompilation                           |
| **Lifecycle Hook** | Code that runs at specific phases (mount, tick start, compile, etc.) |

## Prerequisites

- Basic TypeScript/JavaScript knowledge
- Familiarity with React concepts (helpful but not required)
- An AI provider API key (OpenAI, Anthropic, or Google)

## Getting Help

- [API Reference](/api/) - Complete type documentation
- [Examples](/examples/) - Working code samples
- [GitHub Issues](https://github.com/rlindgren/aidk/issues) - Bug reports and questions
