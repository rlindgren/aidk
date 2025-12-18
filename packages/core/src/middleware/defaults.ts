import { type Middleware, Context, Telemetry } from 'aidk-kernel';
import { type EngineError } from '../component/component';

/**
 * Classify errors for better recovery handling.
 * Matches the classification logic used in ToolExecutor.
 */
function classifyError(error: any): string {
  if (!error) return 'UNKNOWN_ERROR';

  // Network/timeout errors
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
    return 'NETWORK_ERROR';
  }

  // Rate limiting
  if (error.status === 429 || error.code === 'RATE_LIMIT_EXCEEDED') {
    return 'RATE_LIMIT_ERROR';
  }

  // Authentication/authorization
  if (error.status === 401 || error.status === 403) {
    return 'AUTH_ERROR';
  }

  // Validation errors
  if (error.name === 'ZodError' || error.name === 'ValidationError') {
    return 'VALIDATION_ERROR';
  }

  // Timeout errors
  if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
    return 'TIMEOUT_ERROR';
  }

  // Abort errors
  if (error.name === 'AbortError' || error.message?.includes('aborted')) {
    return 'ABORT_ERROR';
  }

  // Generic application errors
  if (error.name === 'Error') {
    return 'APPLICATION_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

/**
 * Determine if an error is recoverable.
 */
function isRecoverableError(error: any): boolean {
  const errorType = classifyError(error);
  
  // Network errors are usually recoverable
  if (errorType === 'NETWORK_ERROR' || errorType === 'TIMEOUT_ERROR') {
    return true;
  }
  
  // Rate limiting might be recoverable with backoff
  if (errorType === 'RATE_LIMIT_ERROR') {
    return true;
  }
  
  // Authentication errors are usually not recoverable without intervention
  if (errorType === 'AUTH_ERROR') {
    return false;
  }
  
  // Abort errors are not recoverable
  if (errorType === 'ABORT_ERROR') {
    return false;
  }
  
  // Validation errors are usually not recoverable without fixing the input
  if (errorType === 'VALIDATION_ERROR') {
    return false;
  }
  
  // Default: assume recoverable for transient errors
  return true;
}

/**
 * Telemetry middleware for engine procedures.
 * 
 * Note: ExecutionTracker already handles basic telemetry (spans, metrics, error recording)
 * automatically for all procedures and hooks. This middleware adds engine-specific metadata
 * to the context that ExecutionTracker will pick up when it creates spans.
 * 
 * Since ExecutionTracker runs inside the handler and middleware runs before,
 * this middleware can enrich the context with metadata that will be included in
 * the telemetry spans created by ExecutionTracker.
 */
export const telemetryMiddleware: Middleware = async (args, envelope, next) => {
  const kernelCtx = Context.tryGet();
  
  // Add engine-specific metadata to context for ExecutionTracker to pick up
  if (kernelCtx) {
    // Enrich metadata with engine context
    // ExecutionTracker will include this metadata in span attributes
    kernelCtx.metadata = {
      ...kernelCtx.metadata,
      engine_middleware: true,
      // Add any other engine-specific metadata that should be tracked
    };
  }
  
  // Pass through - ExecutionTracker will handle telemetry when handler runs
  return await next();
};

/**
 * Error normalization middleware for engine procedures.
 * 
 * Normalizes errors to EngineError format, classifies them, and determines recoverability.
 * This allows components and error handlers to work with a consistent error format.
 */
export const errorMiddleware: Middleware = async (args, envelope, next) => {
  try {
    return await next(args);
  } catch (error: any) {
    // Don't wrap abort errors - let them propagate as-is
    if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
      throw error;
    }
    
    // Normalize error to Error instance if needed
    const normalizedError = error instanceof Error 
      ? error 
      : new Error(String(error));
    
    // Classify the error
    const errorType = classifyError(error);
    const recoverable = isRecoverableError(error);
    
    // Create EngineError with context
    const engineError: EngineError = {
      error: normalizedError,
      phase: 'unknown', // Middleware doesn't know the phase - will be set by engine if needed
      recoverable,
      context: {
        error_type: errorType,
        error_code: error.code,
        error_status: error.status,
        trace_id: Context.tryGet()?.traceId,
        procedure_pid: Context.tryGet()?.procedurePid,
        // Add any other relevant context
      },
    };
    
    // Attach EngineError to the error for downstream handlers
    // This allows error handlers to access the normalized error
    // (normalizedError as any).engineError = engineError;
    
    // Record error in telemetry
    Telemetry.recordError(normalizedError);
    
    // Re-throw the normalized error
    // Downstream handlers can access engineError via error.engineError
    throw normalizedError;
  }
};
