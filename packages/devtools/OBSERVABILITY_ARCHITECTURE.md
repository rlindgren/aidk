# Observability Architecture

## Core Principle

**The kernel emits events with complete, correct data. DevTools is a dumb renderer.**

If DevTools needs to infer, fallback, or do gymnastics to display information, that's a bug in the kernel—not a problem for DevTools to solve.

---

## Key Concepts

### Procedure Graph

The **procedure graph** tracks the call hierarchy of all procedure invocations.

- Every `Procedure` call creates a node
- Parent/child relationships reflect the call stack
- Contains: timing, metrics, metadata, status
- **Source of truth** for what happened

### Execution Graph

The **execution graph** is an annotation overlay on the procedure graph.

- Marks logical "units of work" (engine runs, forks, spawns)
- Only procedures with `executionBoundary` create execution nodes
- Parent/child relationships reflect execution ownership, not call stack
- Used for: DevTools tree view, execution-level metrics

### Execution Boundaries

An **execution boundary** is where a new logical execution begins:

| Boundary Type    | Created By                             | Has Ticks? | Parent Link      |
| ---------------- | -------------------------------------- | ---------- | ---------------- |
| `root`           | `engine.execute()` / `engine.stream()` | Yes        | None             |
| `fork`           | `<Fork>` component                     | Yes        | Parent execution |
| `spawn`          | `<Spawn>` component                    | Yes        | Parent execution |
| `component_tool` | `createComponentTool()`                | Yes        | Parent execution |
| `child`          | Model/tool procedures                  | No         | Within parent    |

### Ticks

A **tick** is one iteration of the engine loop within an execution:

1. **Compile phase**: JSX → COMInput
2. **Model phase**: COMInput → ModelOutput
3. **Tool phase**: Execute any tool calls

Ticks only exist within engine or compile service executions (root, fork, spawn, component_tool).

---

## Metadata Flow

### The `withMetadata` Pattern

Procedures support `withMetadata()` to attach runtime information:

```typescript
// At the call site, attach relevant metadata
procedure.withMetadata({
  modelId: "gpt-4o",
  provider: "openai",
}).call(input);
```

This metadata:

- Merges with static procedure metadata
- Flows to the ProcedureNode
- Is available to DevTools via events
- Is available to telemetry spans

### Required Metadata by Execution Type

Every execution boundary should attach its metadata at creation:

```typescript
// Engine execution (root)
engine.execute.withMetadata({
  component: componentName,  // Root component being executed
})

// Model execution (child)
model.stream.withMetadata({
  modelId: model.metadata.id,
  provider: model.metadata.provider,
})

// Tool execution (child)
tool.run.withMetadata({
  toolName: toolMetadata.name,
  toolId: callId,
})

// Fork/Spawn execution
engine.execute.withMetadata({
  component: forkComponentName,
  parentTick: currentTick,
})
```

---

## Event Schema

### Design Principles

1. **Complete**: Events contain all needed information
2. **No inference**: Display logic doesn't guess or fallback
3. **Typed**: Event types are discriminated unions
4. **Minimal**: Only include what's needed

### Base Event Fields

Every event includes:

```typescript
interface BaseEvent {
  type: string;           // Discriminant
  timestamp: number;      // When it happened
  traceId: string;        // Distributed trace correlation
  executionId: string;    // Which execution
  procedureId: string;    // Which procedure (if applicable)
}
```

### Procedure Metadata in Events

Procedure events include metadata from the procedure node:

```typescript
interface ProcedureEvent extends BaseEvent {
  procedureName: string;
  metadata: {
    type?: "engine" | "model" | "tool";
    // From withMetadata:
    modelId?: string;
    provider?: string;
    toolName?: string;
    toolId?: string;
    component?: string;
  };
}
```

### Execution Events

Execution lifecycle events:

```typescript
interface ExecutionStartEvent extends BaseEvent {
  type: "execution_start";
  executionType: "root" | "fork" | "spawn" | "component_tool";
  parentExecutionId?: string;
  agentName: string;      // From metadata.component or procedure name
}

interface ExecutionEndEvent extends BaseEvent {
  type: "execution_end";
  totalUsage: TokenUsage;
  status: "completed" | "error";
}
```

---

## DevTools Responsibilities

### What DevTools SHOULD Do

- Render events as they arrive
- Aggregate events by execution/procedure
- Provide navigation (tree view, timeline)
- Display metadata as provided

### What DevTools SHOULD NOT Do

- Infer missing information
- Maintain complex fallback chains
- Parse procedure names to extract meaning
- Guess execution types from naming patterns

### Display Logic

With proper metadata, display logic is trivial:

```typescript
function getDisplayName(execution: Execution, procedure: Procedure): string {
  const meta = procedure.metadata;

  // Direct lookup, no fallbacks
  if (meta.component) return meta.component;
  if (meta.modelId) return meta.modelId;
  if (meta.toolName) return meta.toolName;

  return procedure.name;
}

function getBadge(execution: Execution): string | undefined {
  // Direct from execution type
  switch (execution.executionType) {
    case "fork": return "FORK";
    case "spawn": return "SPAWN";
    case "model": return "MODEL";
    case "tool": return "TOOL";
    default: return undefined;
  }
}
```

---

## Debugging Checklist

When DevTools displays incorrect information:

1. **Check the source**: Is `withMetadata` being called with correct values?
2. **Check the event**: Does the emitted event contain the metadata?
3. **Check the subscriber**: Is kernel-subscriber transforming correctly?
4. **Check the aggregation**: Is useDevToolsEvents merging correctly?

If step 4 needs complex logic, the bug is in steps 1-3.

---

## Future Considerations

### Telemetry Integration

Procedure metadata should flow to OpenTelemetry spans:

```typescript
span.setAttribute("model.id", metadata.modelId);
span.setAttribute("tool.name", metadata.toolName);
```

### Execution Graph API

Consider exposing execution graph separately from procedure graph:

```typescript
Context.getExecutionGraph();  // Execution-level view
Context.getProcedureGraph();  // Full call hierarchy
```

### Tick-Level Events

Consider making ticks more explicit in the event stream:

```typescript
interface TickStartEvent {
  type: "tick_start";
  executionId: string;
  tickNumber: number;
}

interface TickEndEvent {
  type: "tick_end";
  executionId: string;
  tickNumber: number;
  phases: TickPhase[];
}
```
