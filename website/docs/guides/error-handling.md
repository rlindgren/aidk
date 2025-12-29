# Error Handling

This guide covers error handling patterns in AIDK—from simple recovery to sophisticated retry strategies.

## The onError Hook

Components can handle errors via the `onError` lifecycle hook:

```tsx
class ResilientAgent extends Component {
  async onError(error, com) {
    console.error("Error occurred:", error);

    // Return instructions for the engine
    return {
      retry: false,      // Don't retry the failed operation
      continue: true,    // Continue execution despite error
    };
  }

  render() {
    return (
      <>
        <Model model={openai("gpt-4o")} />
        <System>You are a helpful assistant.</System>
      </>
    );
  }
}
```

## Error Response Options

The `onError` hook can return different instructions:

```typescript
interface ErrorResponse {
  // Retry the failed operation
  retry?: boolean;

  // Continue execution after error (don't throw)
  continue?: boolean;

  // Custom error to throw instead
  throw?: Error;

  // Delay before retry (ms)
  retryDelay?: number;

  // Maximum retry attempts
  maxRetries?: number;
}
```

## Common Patterns

### Pattern 1: Automatic Retry

Retry transient failures with exponential backoff:

```tsx
class RetryingAgent extends Component {
  private retryCount = signal(0);
  private maxRetries = 3;

  async onError(error, com) {
    const count = this.retryCount();

    // Only retry certain errors
    if (this.isRetryable(error) && count < this.maxRetries) {
      this.retryCount.set(count + 1);

      return {
        retry: true,
        retryDelay: Math.pow(2, count) * 1000, // Exponential backoff
      };
    }

    // Don't retry, but continue execution
    com.setState("lastError", error.message);
    return { continue: true };
  }

  private isRetryable(error: Error): boolean {
    const retryableCodes = ["RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE"];
    return retryableCodes.includes(error.code);
  }

  render(com) {
    const lastError = com.getState("lastError");

    return (
      <>
        <Model model={openai("gpt-4o")} />
        {lastError && (
          <System>Note: A previous error occurred: {lastError}</System>
        )}
        <System>You are a helpful assistant.</System>
      </>
    );
  }
}
```

### Pattern 2: Fallback Model

Switch to a backup model on failure:

```tsx
class FallbackAgent extends Component {
  private useFallback = signal(false);
  private primaryErrors = signal(0);

  async onError(error, com) {
    if (error.source === "model") {
      const errors = this.primaryErrors() + 1;
      this.primaryErrors.set(errors);

      if (errors >= 2) {
        this.useFallback.set(true);
      }

      return { retry: true };
    }

    return { continue: false }; // Propagate other errors
  }

  render() {
    const model = this.useFallback()
      ? anthropic("claude-3-haiku")  // Fallback
      : openai("gpt-4o");             // Primary

    return (
      <>
        <Model model={model} />
        <System>You are a helpful assistant.</System>
      </>
    );
  }
}
```

### Pattern 3: Graceful Degradation

Continue with reduced functionality on error:

```tsx
class DegradingAgent extends Component {
  private features = signal({
    search: true,
    analysis: true,
    generation: true,
  });

  async onError(error, com) {
    // Disable the feature that failed
    if (error.source === "tool" && error.toolName) {
      const features = { ...this.features() };

      switch (error.toolName) {
        case "web_search":
          features.search = false;
          break;
        case "analyze":
          features.analysis = false;
          break;
      }

      this.features.set(features);
      com.setState("degraded", true);
    }

    return { continue: true };
  }

  render(com) {
    const features = this.features();
    const degraded = com.getState("degraded");

    return (
      <>
        <Model model={openai("gpt-4o")} />

        {degraded && (
          <System priority="high">
            Some features are temporarily unavailable.
          </System>
        )}

        <System>You are a helpful assistant.</System>

        {/* Only include working tools */}
        {features.search && <SearchTool />}
        {features.analysis && <AnalysisTool />}
        {features.generation && <GenerationTool />}
      </>
    );
  }
}
```

### Pattern 4: Error Logging and Monitoring

Log errors for debugging and monitoring:

```tsx
class MonitoredAgent extends Component {
  async onError(error, com) {
    // Log to monitoring service
    await this.logError(error, com);

    // Decide how to handle based on severity
    if (error.severity === "critical") {
      // Alert and stop
      await this.alert(error);
      return { continue: false };
    }

    if (error.severity === "warning") {
      // Log and continue
      return { continue: true };
    }

    // Retry transient errors
    return { retry: true, retryDelay: 1000 };
  }

  private async logError(error: Error, com: COM) {
    await fetch("/api/errors", {
      method: "POST",
      body: JSON.stringify({
        error: error.message,
        stack: error.stack,
        context: {
          tick: com.getState("tick"),
          userId: com.getState("userId"),
          sessionId: com.getState("sessionId"),
        },
      }),
    });
  }

  private async alert(error: Error) {
    await fetch("/api/alerts", {
      method: "POST",
      body: JSON.stringify({ error: error.message }),
    });
  }
}
```

### Pattern 5: User-Facing Error Messages

Translate technical errors to user-friendly messages:

```tsx
class UserFriendlyAgent extends Component {
  private userError = signal<string | null>(null);

  async onError(error, com) {
    const userMessage = this.translateError(error);
    this.userError.set(userMessage);

    return { continue: true };
  }

  private translateError(error: Error): string {
    const translations: Record<string, string> = {
      RATE_LIMIT: "I'm receiving too many requests. Please wait a moment.",
      TIMEOUT: "The request took too long. Let me try again.",
      INVALID_API_KEY: "There's a configuration issue. Please contact support.",
      CONTEXT_LENGTH: "The conversation is too long. Let me summarize.",
    };

    return translations[error.code] || "Something went wrong. Please try again.";
  }

  render() {
    const error = this.userError();

    return (
      <>
        <Model model={openai("gpt-4o")} />

        {error && (
          <AssistantMessage>{error}</AssistantMessage>
        )}

        <System>You are a helpful assistant.</System>
      </>
    );
  }
}
```

### Pattern 6: Circuit Breaker

Stop retrying after repeated failures:

```tsx
class CircuitBreakerAgent extends Component {
  private failures = signal(0);
  private circuitOpen = signal(false);
  private lastFailure = signal<number>(0);

  private threshold = 5;
  private resetTimeout = 30000; // 30 seconds

  async onError(error, com) {
    const now = Date.now();
    const failures = this.failures() + 1;
    this.failures.set(failures);
    this.lastFailure.set(now);

    if (failures >= this.threshold) {
      this.circuitOpen.set(true);
    }

    return { continue: true };
  }

  async onTickStart(com) {
    // Check if circuit should reset
    if (this.circuitOpen()) {
      const elapsed = Date.now() - this.lastFailure();

      if (elapsed > this.resetTimeout) {
        // Reset circuit
        this.circuitOpen.set(false);
        this.failures.set(0);
      }
    }
  }

  render() {
    if (this.circuitOpen()) {
      return (
        <AssistantMessage>
          The service is temporarily unavailable. Please try again later.
        </AssistantMessage>
      );
    }

    return (
      <>
        <Model model={openai("gpt-4o")} />
        <System>You are a helpful assistant.</System>
      </>
    );
  }
}
```

## Tool Error Handling

Tools can handle their own errors:

```tsx
const ResilientTool = createTool({
  name: "resilient_api",
  parameters: z.object({ query: z.string() }),

  handler: async ({ query }) => {
    try {
      return await apiCall(query);
    } catch (error) {
      // Return error as result instead of throwing
      return {
        success: false,
        error: error.message,
        suggestion: "Try a different query",
      };
    }
  },
});
```

Or throw structured errors:

```tsx
import { ToolError } from "aidk";

const ValidatingTool = createTool({
  name: "validated_action",
  parameters: z.object({ value: z.number() }),

  handler: async ({ value }) => {
    if (value < 0) {
      throw new ToolError({
        code: "VALIDATION_ERROR",
        message: "Value must be positive",
        retryable: false,
        userMessage: "Please provide a positive number",
      });
    }

    return performAction(value);
  },
});
```

## Error Types

AIDK provides structured error types:

```typescript
import {
  NotFoundError,
  ValidationError,
  AbortError,
  TimeoutError,
  RateLimitError,
} from "aidk-shared";

// Usage
throw new NotFoundError("model", modelId);
throw ValidationError.required("messages");
throw AbortError.timeout(30000);
throw new RateLimitError("Too many requests", { retryAfter: 60 });
```

## State Recovery

For long-running agents, persist state for crash recovery:

```tsx
class PersistentAgent extends Component {
  async onMount(com) {
    // Restore state on startup
    const savedState = await this.loadState(com.getState("sessionId"));
    if (savedState) {
      Object.entries(savedState).forEach(([key, value]) => {
        com.setState(key, value);
      });
    }
  }

  async onTickEnd(com, state) {
    // Persist state after each tick
    await this.saveState(com.getState("sessionId"), {
      timeline: state.current?.timeline,
      customState: com.getState("customState"),
    });
  }

  async onError(error, com) {
    // Save error state for debugging
    await this.saveErrorState(com.getState("sessionId"), error);
    return { continue: true };
  }

  private async loadState(sessionId: string) {
    return await redis.get(`agent:${sessionId}:state`);
  }

  private async saveState(sessionId: string, state: any) {
    await redis.set(`agent:${sessionId}:state`, state);
  }
}
```

## Best Practices

1. **Be specific about retries**: Only retry transient errors
2. **Use exponential backoff**: Avoid overwhelming failing services
3. **Set retry limits**: Prevent infinite retry loops
4. **Degrade gracefully**: Continue with reduced functionality when possible
5. **Log comprehensively**: Capture context for debugging
6. **Translate for users**: Don't expose technical errors to end users
7. **Persist for recovery**: Save state for crash recovery in critical flows

## Key Takeaways

1. **onError** hook intercepts all errors in the component tree
2. Return `{ retry: true }` to retry, `{ continue: true }` to proceed
3. Use signals to track error state and modify behavior
4. Implement fallbacks for critical functionality
5. Log errors for monitoring and debugging

## Next Steps

- [Testing](./testing) - Test error handling paths
- [Tick Lifecycle](/docs/concepts/tick-lifecycle) - Full hook reference
- [State Management](/docs/state-management) - Persisting error state
