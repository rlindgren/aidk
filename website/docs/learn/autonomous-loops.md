# Autonomous Loops

This tutorial covers the "Ralph Wiggum" pattern—autonomous loops that iterate until a task is complete.

## The Pattern

Traditional AI workflows involve carefully directing each step. Autonomous loops invert this: you define success criteria upfront and let the agent converge through repeated attempts.

The philosophy: **let it fail repeatedly until it succeeds.**

This reframes the skill from "step-by-step direction" to "writing prompts that naturally converge toward correct solutions."

## RalphLoop Component

Here's a reusable wrapper that makes any component autonomous:

```tsx
import { useSignal, useTickEnd, Complete, Grounding, StopReason } from "aidk";

interface RalphLoopProps {
  /** The component to run autonomously */
  root?: JSX.Element;
  /** Alternative: use children */
  children?: JSX.Element;
  /** Maximum iterations before stopping (safety valve) */
  maxIterations?: number;
  /** Function that returns true when the task is complete */
  isComplete: (com: COM, state: TickState) => boolean | Promise<boolean>;
  /** Optional callback after each iteration */
  onIteration?: (iteration: number, com: COM, state: TickState) => void;
}

const RalphLoop = ({
  root,
  children,
  maxIterations = 50,
  isComplete,
  onIteration,
}: RalphLoopProps) => {
  const iteration = useSignal(0);
  const done = useSignal(false);

  useTickEnd(async (com, state) => {
    iteration.update((i) => i + 1);
    onIteration?.(iteration(), com, state);

    // Check if model thinks it's done (non-tool stop reason)
    const stopReason = state.stopReason?.reason;
    const modelThinksDone = stopReason && stopReason !== StopReason.TOOL_USE;

    if (modelThinksDone) {
      // Check our completion criteria
      if (await isComplete(com, state)) {
        done.set(true);
      } else if (iteration() < maxIterations) {
        // Model thinks done but we're not - force another iteration
        com.requestContinue({ reason: "ralph-loop-iteration" });
      }
    }
  });

  if (done()) {
    return <Complete />;
  }

  if (iteration() >= maxIterations) {
    return (
      <Complete>
        <Assistant>Max iterations ({maxIterations}) reached.</Assistant>
      </Complete>
    );
  }

  // Children take priority over root prop
  const content = children ?? root;

  return (
    <>
      <Grounding>
        Iteration {iteration()} of {maxIterations}. Keep working until the task
        is complete.
      </Grounding>
      {content}
    </>
  );
};
```

## Basic Usage

Wrap any component to make it autonomous:

```tsx
// Using children
<RalphLoop
  maxIterations={50}
  isComplete={async () => {
    const result = await shell('pnpm test');
    return result.exitCode === 0;
  }}
>
  <TestFixerAgent />
</RalphLoop>

// Using root prop
<RalphLoop
  root={<TestFixerAgent />}
  maxIterations={50}
  isComplete={async () => {
    const result = await shell('pnpm test');
    return result.exitCode === 0;
  }}
/>
```

The wrapped component doesn't need to know it's being looped—it just does its job each tick.

## Completion Criteria

The key to autonomous loops is well-defined completion criteria. The `isComplete` function should return `true` when the task is done.

### Code-Based Criteria

```tsx
// All tests pass
isComplete={async () => {
  const result = await shell('pnpm test');
  return result.exitCode === 0;
}}

// No TypeScript errors
isComplete={async () => {
  const result = await shell('pnpm tsc --noEmit');
  return result.exitCode === 0;
}}

// No lint errors
isComplete={async () => {
  const result = await shell('pnpm lint');
  return result.exitCode === 0;
}}

// Coverage threshold met
isComplete={async () => {
  const result = await shell('pnpm test --coverage --json');
  const coverage = JSON.parse(result.stdout);
  return coverage.total.lines.pct >= 80;
}}
```

### File-Based Criteria

```tsx
// No Jest imports remain (migration complete)
isComplete={async () => {
  const result = await shell('grep -r "from \\"jest\\"" src/');
  return result.exitCode !== 0; // grep returns 1 when no matches
}}

// All files have documentation
isComplete={async () => {
  const result = await shell('find src -name "*.ts" -exec grep -L "^/\\*\\*" {} \\;');
  return result.stdout.trim() === '';
}}

// Specific file exists
isComplete={async () => {
  return fs.existsSync('src/generated/api-client.ts');
}}
```

### State-Based Criteria

```tsx
// Check COM state
isComplete={async (com) => {
  const status = com.getState('migrationStatus');
  return status === 'complete';
}}

// Check for specific content in response
isComplete={async (com, state) => {
  const lastMessage = state.current?.timeline?.at(-1);
  return lastMessage?.message?.content?.some(
    block => block.type === 'text' && block.text.includes('TASK COMPLETE')
  );
}}
```

## Examples

### Jest to Vitest Migration

```tsx
const JestToVitestMigrator = () => (
  <>
    <Model model={anthropic("claude-sonnet-4")} />
    <System>
      You are migrating a codebase from Jest to Vitest.

      For each file:
      1. Replace jest imports with vitest imports
      2. Update any Jest-specific APIs to Vitest equivalents
      3. Run the tests to verify they pass

      Focus on one file at a time. Use the tools to read, modify, and test files.
    </System>
    <FileSystemTools />
    <ShellTool />
  </>
);

// Usage
<RalphLoop
  maxIterations={100}
  isComplete={async () => {
    // Check no Jest imports remain AND tests pass
    const grepResult = await shell('grep -r "from \\"jest\\"" src/');
    const hasJest = grepResult.exitCode === 0;

    if (hasJest) return false;

    const testResult = await shell('pnpm test');
    return testResult.exitCode === 0;
  }}
  onIteration={(i) => console.log(`Migration iteration ${i}`)}
>
  <JestToVitestMigrator />
</RalphLoop>
```

### Test Coverage Improver

```tsx
const CoverageImprover = ({ targetCoverage = 80 }) => (
  <>
    <Model model={anthropic("claude-sonnet-4")} />
    <System>
      You are improving test coverage for this codebase.
      Target: {targetCoverage}% line coverage.

      1. Run coverage to find uncovered files
      2. Pick the file with lowest coverage
      3. Add tests for uncovered lines
      4. Verify tests pass

      Focus on one file per iteration.
    </System>
    <FileSystemTools />
    <ShellTool />
  </>
);

<RalphLoop
  maxIterations={50}
  isComplete={async () => {
    const result = await shell('pnpm test --coverage --json 2>/dev/null');
    try {
      const coverage = JSON.parse(result.stdout);
      return coverage.total.lines.pct >= 80;
    } catch {
      return false;
    }
  }}
>
  <CoverageImprover targetCoverage={80} />
</RalphLoop>
```

### Documentation Generator

```tsx
const DocGenerator = () => (
  <>
    <Model model={anthropic("claude-sonnet-4")} />
    <System>
      You are adding JSDoc comments to all exported functions.

      1. Find a file missing documentation
      2. Read the file and understand the exports
      3. Add comprehensive JSDoc comments
      4. Move to the next file

      Skip files that already have complete documentation.
    </System>
    <FileSystemTools />
    <ShellTool />
  </>
);

<RalphLoop
  maxIterations={100}
  isComplete={async () => {
    // Check all .ts files have JSDoc on exports
    const result = await shell(`
      for f in $(find src -name "*.ts"); do
        if grep -q "^export" "$f" && ! grep -q "^/\\*\\*" "$f"; then
          exit 1
        fi
      done
    `);
    return result.exitCode === 0;
  }}
>
  <DocGenerator />
</RalphLoop>
```

## When to Use Autonomous Loops

The pattern works best for **mechanical, well-defined tasks**:

| Good Fit                  | Poor Fit                            |
| ------------------------- | ----------------------------------- |
| Large refactors           | Creative writing                    |
| Framework migrations      | Ambiguous requirements              |
| Batch file operations     | Tasks needing human judgment        |
| Test coverage improvement | Security-sensitive operations       |
| Documentation generation  | Tasks without clear "done" criteria |
| Code standardization      | Open-ended exploration              |

## Safety Considerations

### Always Set Max Iterations

Autonomous loops consume API credits quickly. Always set a reasonable `maxIterations`:

```tsx
<RalphLoop
  maxIterations={50}  // Safety valve!
  isComplete={...}
>
  {/* ... */}
</RalphLoop>
```

### Monitor Progress

Use `onIteration` to track progress and detect issues early:

```tsx
<RalphLoop
  maxIterations={50}
  isComplete={...}
  onIteration={(iteration, com, state) => {
    console.log(`Iteration ${iteration}`);
    console.log(`Tokens used: ${state.usage?.totalTokens}`);

    // Could also write to a log file, send metrics, etc.
  }}
>
  {/* ... */}
</RalphLoop>
```

### Context Management

The wrapped component receives the same user input each execution. In long-running loops, context can grow unboundedly as the conversation history accumulates. Consider adding context compaction:

```tsx
<RalphLoop maxIterations={50} isComplete={...}>
  <SlidingWindowTimeline windowSize={20} />
  <TestFixerAgent />
</RalphLoop>
```

Or summarize previous attempts periodically to keep context manageable.

### Idempotent Operations

Ensure the wrapped component's operations are safe to repeat:

- Git commits should check if changes exist first
- File writes should be idempotent
- API calls should handle already-completed states

## Variations

### With Token Budget

Stop when token budget is exhausted:

```tsx
const RalphLoopWithBudget = ({ maxTokens = 100000, ...props }) => {
  const totalTokens = useSignal(0);

  const wrappedIsComplete = async (com, state) => {
    totalTokens.update(t => t + (state.usage?.totalTokens ?? 0));

    if (totalTokens() >= maxTokens) {
      return true; // Budget exhausted
    }

    return props.isComplete(com, state);
  };

  return <RalphLoop {...props} isComplete={wrappedIsComplete} />;
};
```

### With Checkpointing

Save progress between iterations:

```tsx
const RalphLoopWithCheckpoints = (props) => {
  return (
    <RalphLoop
      {...props}
      onIteration={async (iteration, com) => {
        // Save checkpoint
        await fs.writeFile(
          `.ralph-checkpoint-${iteration}.json`,
          JSON.stringify(com.getState())
        );
        props.onIteration?.(iteration, com);
      }}
    />
  );
};
```

## Key Takeaways

1. **Define success clearly**: The `isComplete` function is everything
2. **Set safety bounds**: Always use `maxIterations`
3. **Monitor progress**: Use `onIteration` for visibility
4. **Use for mechanical tasks**: Best for well-defined, repeatable work
5. **The agent doesn't know**: Wrapped components are unaware they're looping

## Attribution

This pattern is inspired by the [Ralph Wiggum plugin](https://paddo.dev/blog/ralph-wiggum-autonomous-loops/) by Paddo, which implements autonomous loops for Claude Code.

## Next Steps

- [Parallel Agents](/docs/learn/parallel-agents) - Run multiple agents concurrently
- [Tools as Components](/docs/learn/tools-as-components) - Tools that render context
- [Understanding Ticks](/docs/learn/understanding-ticks) - How the tick loop works
