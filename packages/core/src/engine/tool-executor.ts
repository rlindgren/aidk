import { type AgentToolCall, type AgentToolResult, type ExecutableTool, ToolExecutionType } from '../tool/tool';
import { ContextObjectModel } from '../com/object-model';
import { type ContentBlock } from 'aidk-shared';
import { type ToolHookMiddleware, type ToolHookName, ToolHookRegistry } from '../tool/tool-hooks';
import { createEngineProcedure } from '../procedure';
import { ClientToolCoordinator } from './client-tool-coordinator';

/**
 * Tool Execution Service
 * 
 * Handles tool execution with error handling, parallel execution support,
 * and structured error reporting. Designed to be extensible for future
 * features like retries, timeouts, circuit breakers, etc.
 */
export class ToolExecutor {
  private clientToolCoordinator: ClientToolCoordinator;

  constructor(private toolHooks?: ToolHookRegistry) {
    this.clientToolCoordinator = new ClientToolCoordinator();
  }

  /**
   * Get the client tool coordinator for managing client-executed tools.
   */
  getClientToolCoordinator(): ClientToolCoordinator {
    return this.clientToolCoordinator;
  }

  /**
   * Wrap tool.run with hooks if hooks are registered.
   * Since tool.run is already a Procedure, we create a wrapper Procedure that:
   * 1. Applies hook middleware to the input
   * 2. Calls the original tool.run Procedure
   * This preserves the Procedure interface (with .use() and .withHandle()).
   * 
   * Returns undefined if tool has no handler (e.g., client tools without server-side execution).
   */
  private wrapToolRun(tool: ExecutableTool): ExecutableTool['run'] | undefined {
    if (!tool.run) {
      return undefined; // Tool has no handler
    }

    if (!this.toolHooks) {
      return tool.run;
    }

    const middleware = this.toolHooks.getMiddleware('run') as ToolHookMiddleware<ToolHookName>[];
    if (middleware.length === 0) {
      return tool.run;
    }

    // tool.run is already a Procedure - create a wrapper Procedure that uses hooks
    // Use createProcedure (not createEngineProcedure) to avoid duplicating middleware
    // since the original Procedure already has telemetry, error, and global middleware
    const originalRun = tool.run;
    
    // Create a wrapper Procedure that applies hooks, then calls the original Procedure
    const wrappedProc = createEngineProcedure({ name: tool.metadata.name }, async (input: any) => {
      return originalRun(input) as Promise<ContentBlock[]>;
    });

    return wrappedProc as ExecutableTool['run'];
  }
  /**
   * Execute tool calls sequentially or in parallel.
   * 
   * @param toolCalls Array of tool calls to execute
   * @param com ContextObjectModel for tool resolution
   * @param parallel Whether to execute tools in parallel (default: false)
   * @param configTools Optional array of tools from Engine config for fallback resolution
   * @returns Array of tool results
   */
  async executeToolCalls(
    toolCalls: AgentToolCall[],
    com: ContextObjectModel,
    parallel: boolean = false,
    configTools: ExecutableTool[] = []
  ): Promise<AgentToolResult[]> {
    if (parallel && toolCalls.length > 1) {
      return this.executeParallel(toolCalls, com, configTools);
    }
    return this.executeSequential(toolCalls, com, configTools);
  }

  /**
   * Execute tools sequentially (current implementation).
   * Provides better error isolation and easier debugging.
   */
  private async executeSequential(
    toolCalls: AgentToolCall[],
    com: ContextObjectModel,
    configTools: ExecutableTool[] = []
  ): Promise<AgentToolResult[]> {
    const results: AgentToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.executeSingleTool(call, com, configTools);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute tools in parallel (future implementation).
   * Will be enhanced with proper error handling, timeouts, etc.
   */
  private async executeParallel(
    toolCalls: AgentToolCall[],
    com: ContextObjectModel,
    configTools: ExecutableTool[] = []
  ): Promise<AgentToolResult[]> {
    // TODO: Implement proper parallel execution with:
    // - Timeout handling
    // - Error isolation
    // - Result ordering preservation
    // - Circuit breaker patterns
    const promises = toolCalls.map(call => this.executeSingleTool(call, com, configTools));
    return Promise.all(promises);
  }

  /**
   * Execute a single tool call with comprehensive error handling.
   */
  private async executeSingleTool(
    call: AgentToolCall,
    com: ContextObjectModel,
    configTools: ExecutableTool[] = []
  ): Promise<AgentToolResult> {
    // 1. Resolve tool
    let tool: ExecutableTool | undefined = com.getTool(call.name);

    // 2. Fallback to config tools
    if (!tool && configTools.length > 0) {
      tool = configTools.find(t => t.metadata.name === call.name);
    }

    if (!tool) {
      return this.createErrorResult(
        call,
        `Tool "${call.name}" is not available`,
        'TOOL_NOT_FOUND'
      );
    }

    // 3. Check execution type and route accordingly
    const executionType = tool.metadata.type ?? ToolExecutionType.SERVER;
    
    // Provider tools should be handled in ModelAdapter, not here
    if (executionType === ToolExecutionType.PROVIDER) {
      return this.createErrorResult(
        call,
        `Provider-executed tool "${call.name}" should be handled by ModelAdapter`,
        'INVALID_EXECUTION_TYPE'
      );
    }

    // Client tools - delegate to client and wait for result if needed
    if (executionType === ToolExecutionType.CLIENT) {
      const requiresResponse = tool.metadata.requiresResponse ?? false;
      const timeout = tool.metadata.timeout ?? 30000;
      const defaultResult: AgentToolResult = {
        tool_use_id: call.id,
        name: call.name || call.id,
        success: true,
        content: tool.metadata.defaultResult ?? [
          { type: 'text', text: `[${call.name} rendered on client]` }
        ],
      };

      // If doesn't require response, return default immediately
      if (!requiresResponse) {
        return defaultResult;
      }

      // Otherwise wait for client to send result
      try {
        return await this.clientToolCoordinator.waitForResult(
          call.id,
          defaultResult,
          requiresResponse,
          timeout
        );
      } catch (error: any) {
        return this.createErrorResult(
          call,
          error.message || 'Client tool execution failed',
          'CLIENT_TOOL_ERROR',
          error
        );
      }
    }

    // 4. Execute tool with error handling (SERVER or MCP)
    try {
      // Wrap tool.run with hooks if hooks are registered
      const wrappedRun = this.wrapToolRun(tool);
      
      if (!wrappedRun) {
        // Tool has no handler (e.g., client tool without server-side execution)
        // Return error - tools without handlers cannot be executed server-side
        return this.createErrorResult(
          call,
          `Tool "${call.name}" has no handler. Tools without handlers cannot be executed server-side.`,
          'TOOL_NO_HANDLER'
        );
      }
      
      // Execute tool (execution type doesn't change the call pattern,
      // but MCP/CLIENT tools have different run() implementations)
      const result = await wrappedRun(call.input);
      
      // Handle async iterable result (shouldn't happen for tools, but be safe)
      let content: ContentBlock[];
      if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
        // If it's an async iterable, collect all chunks
        const chunks: ContentBlock[] = [];
        for await (const chunk of result as AsyncIterable<ContentBlock>) {
          chunks.push(chunk);
        }
        content = chunks;
      } else {
        content = result as ContentBlock[];
      }
      
      // Validate return type
      if (!Array.isArray(content)) {
        return this.createErrorResult(
          call,
          'Tool must return ContentBlock[]',
          'INVALID_RETURN_TYPE'
        );
      }

      // Validate content blocks
      for (const block of content) {
        if (!block || typeof block !== 'object' || !block.type) {
          return this.createErrorResult(
            call,
            'Tool returned invalid ContentBlock',
            'INVALID_CONTENT_BLOCK'
          );
        }
      }

      const toolResult: AgentToolResult = {
        tool_use_id: call.id,
        name: call.name || call.id,
        success: true,
        content,
      };

      call.tool_result = toolResult;

      return toolResult;
    } catch (error: any) {
      // Enhanced error handling
      const errorMessage = error?.message || 'Tool execution failed';
      const errorType = this.classifyError(error);
      
      return this.createErrorResult(call, errorMessage, errorType, error);
    }
  }

  /**
   * Create an error result with structured error information.
   */
  private createErrorResult(
    call: AgentToolCall,
    message: string,
    errorType: string,
    originalError?: any
  ): AgentToolResult {
    const errorContent: ContentBlock[] = [{
      type: 'text' as const,
      text: JSON.stringify({
        error: message,
        error_type: errorType,
        ...(originalError && {
          error_details: {
            name: originalError?.name,
            code: originalError?.code,
            stack: process.env['NODE_ENV'] === 'development' ? originalError?.stack : undefined,
          }
        })
      })
    }];

    const toolResult: AgentToolResult = {
      tool_use_id: call.id,
      name: call.name || call.id,
      success: false,
      content: errorContent,
      error: message,
    };

    call.tool_result = toolResult;

    return toolResult;
  }

  /**
   * Classify errors for better recovery handling.
   */
  private classifyError(error: any): string {
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

    // Generic application errors
    if (error.name === 'Error') {
      return 'APPLICATION_ERROR';
    }

    return 'UNKNOWN_ERROR';
  }
}

