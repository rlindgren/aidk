import OpenAI, { type ClientOptions } from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

import { createLanguageModel, Logger, type EngineModel } from 'aidk';
import {
  type ModelInput,
  type ModelOutput,
  type StreamChunk,
  StopReason,
  type ToolDefinition,
} from 'aidk';
import { type Message, type ContentBlock, type TextBlock } from 'aidk/content';
import { normalizeModelInput } from 'aidk/normalization';
import { type OpenAIAdapterConfig, STOP_REASON_MAP } from './types';

export type OpenAIAdapter = EngineModel<ModelInput, ModelOutput>;

const logger = Logger.for('OpenAIAdapter');

/**
 * Factory function for creating OpenAI model adapter using createModel
 */
export function createOpenAIModel(config: OpenAIAdapterConfig = {}): OpenAIAdapter {
  const client = config.client ?? new OpenAI(buildClientOptions(config));

  return createLanguageModel<
    ModelInput,
    ModelOutput,
    OpenAI.Chat.Completions.ChatCompletionCreateParams,
    ChatCompletion,
    ChatCompletionChunk
  >({
    metadata: {
      id: 'openai',
      provider: 'openai',
      model: config.model,
      type: 'language' as const,
      capabilities: [
        { stream: true, toolCalls: true, provider: 'openai' },
        {
          // Use function to inspect actual model and make intelligent decisions
          messageTransformation: (modelId: string, provider?: string) => {
            const isGPT4 = modelId.includes('gpt-4') || modelId.includes('o1');
            const supportsDeveloper = isGPT4; // GPT-4 and newer support developer role
            
            return {
              preferredRenderer: 'markdown', // OpenAI models work best with markdown
              roleMapping: {
                event: supportsDeveloper ? 'developer' : 'user',
                ephemeral: supportsDeveloper ? 'developer' : 'user',
              },
              delimiters: {
                useDelimiters: !supportsDeveloper, // Only use delimiters if no developer role
                event: '[Event]',
                ephemeral: '[Context]',
              },
              ephemeralPosition: 'flow',
            };
          }
        }
      ],
    },
    transformers: {
      prepareInput: (input) => prepareInput(input, config),
      processOutput,
      processChunk,
      processStream: processStreamChunks,
    },
    executors: {
      execute: (params) => execute(client, params),
      executeStream: (params) => executeStream(client, params),
    }
  });
}

/**
 * Factory function for creating OpenAI adapter (alias for createOpenAIModel)
 */
export function openai(config?: OpenAIAdapterConfig): OpenAIAdapter {
  return createOpenAIModel(config);
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildClientOptions(config: OpenAIAdapterConfig): ClientOptions {
  const options: ClientOptions = {
    apiKey: config.apiKey ?? process.env['OPENAI_API_KEY'],
    baseURL: config.baseURL ?? process.env['OPENAI_BASE_URL'],
    organization: config.organization ?? process.env['OPENAI_ORGANIZATION'],
    defaultHeaders: config.headers,
    ...(config.providerOptions?.openai || {}),
  };

  // Remove undefined values
  Object.keys(options).forEach((key) => {
    if ((options as any)[key] === undefined) {
      delete (options as any)[key];
    }
  });

  return options as ClientOptions;
}

/**
 * Convert Message to OpenAI ChatCompletionMessageParam(s)
 * 
 * Note: Messages with tool_result blocks are expanded into multiple
 * OpenAI messages (one per tool result), as OpenAI requires separate
 * role='tool' messages for each tool call response.
 */
function toOpenAIMessages(message: Message): ChatCompletionMessageParam[] {
  const content: any[] = [];
  const tool_calls: any[] = [];
  const toolResultMessages: ChatCompletionMessageParam[] = [];

  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        content.push({ type: 'text', text: block.text });
        break;

      case 'image':
        if (block.source.type === 'url') {
          content.push({
            type: 'image_url',
            image_url: { url: block.source.url },
          });
        } else if (block.source.type === 'base64') {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.mime_type};base64,${block.source.data}`,
            },
          });
        }
        break;

      case 'tool_use':
        tool_calls.push({
          id: block.tool_use_id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
        break;

      case 'tool_result':
        // Each tool_result becomes a separate OpenAI message
        const resultContent = block.content || [];
        const resultText = resultContent
          .filter((c: any) => c.type === 'text')
          .map((c: any) => (c as TextBlock).text)
          .join('\n');

        toolResultMessages.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: resultText || 'Done',
        } as any);
        break;

      default:
        // Unexpected block type - convert to text as fallback
        // This should rarely happen if fromEngineState is working correctly,
        // but provides graceful degradation for unexpected types
        const blockType = (block as any).type || 'unknown';
        const blockText = (block as any).text || JSON.stringify(block, null, 2);
        logger.warn(`[OpenAI Adapter] Unexpected block type "${blockType}" - converting to text. This should have been converted by fromEngineState.`);
        content.push({ type: 'text', text: blockText });
        break;
    }
  }

  // If this message only contains tool_results, return those
  if (toolResultMessages.length > 0 && content.length === 0 && tool_calls.length === 0) {
    return toolResultMessages;
  }

  // Build the base message
  const baseMessage: any = {
    role: message.role,
    content: content.length > 0 ? content : null,
  };

  if (tool_calls.length > 0) {
    baseMessage.tool_calls = tool_calls;
  }

  // Return base message followed by any tool results
  const result: ChatCompletionMessageParam[] = [baseMessage];
  if (toolResultMessages.length > 0) {
    result.push(...toolResultMessages);
  }

  return result;
}

/**
 * Map tool definition to OpenAI format
 */
function mapToolDefinition(tool: any): OpenAI.Chat.Completions.ChatCompletionTool {
  if (typeof tool === 'string') {
    return {
      type: 'function',
      function: {
        name: tool,
        description: '',
        parameters: {},
      },
    } as OpenAI.Chat.Completions.ChatCompletionTool;
  }

  if ('name' in tool && 'parameters' in tool) {
    const toolDef = tool as ToolDefinition;
    const baseTool: OpenAI.Chat.Completions.ChatCompletionTool = {
      type: 'function',
      function: {
        name: toolDef.name,
        description: toolDef.description || '',
        parameters: toolDef.parameters || {},
      },
    };

    if (toolDef.providerOptions?.openai) {
      const openAIConfig = toolDef.providerOptions.openai;
      return {
        ...baseTool,
        ...openAIConfig, // Spread provider-specific config (may override type, function, etc.)
        function: {
          ...baseTool.function,
          ...(openAIConfig.function || {}), // Merge function-specific options
        },
      } as OpenAI.Chat.Completions.ChatCompletionTool;
    }

    return baseTool;
  }

  // ModelToolReference shape (with metadata)
  const metadata = (tool as any).metadata || tool;
  return {
    type: 'function',
    function: {
      name: metadata?.id || metadata?.name || 'unknown',
      description: metadata?.description || '',
      parameters: metadata?.inputSchema || {},
    },
  } as OpenAI.Chat.Completions.ChatCompletionTool;
}



/**
 * Convert ModelInput to OpenAI ChatCompletionCreateParams
 */
async function prepareInput(
  input: ModelInput,
  config: OpenAIAdapterConfig
): Promise<OpenAI.Chat.Completions.ChatCompletionCreateParams> {
  // Normalize input (handles message normalization, tool resolution, config merging)
  const normalizedInput = normalizeModelInput(input, config);

  const messages: ChatCompletionMessageParam[] = [];

  // Convert messages to OpenAI format
  // Note: toOpenAIMessages returns an array (tool_result blocks expand to multiple messages)
  for (const message of normalizedInput.messages) {
    messages.push(...toOpenAIMessages(message));
  }

  // Convert tools to OpenAI format (using normalized tools)
  const openAITools = normalizedInput.tools.length > 0
    ? normalizedInput.tools.map((tool) => mapToolDefinition(tool.metadata))
    : undefined;

  const baseParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model: normalizedInput.model as string,
    messages,
    temperature: normalizedInput.temperature,
    max_tokens: normalizedInput.maxTokens,
    top_p: normalizedInput.topP,
    frequency_penalty: normalizedInput.frequencyPenalty,
    presence_penalty: normalizedInput.presencePenalty,
    stop: normalizedInput.stop,
    tools: openAITools && openAITools.length > 0 ? openAITools : undefined,
    // Explicitly set tool_choice to auto when tools are available
    tool_choice: openAITools && openAITools.length > 0 ? 'auto' : undefined,
  };

  // Clean undefined values
  Object.keys(baseParams).forEach((key) => {
    if ((baseParams as any)[key] === undefined) {
      delete (baseParams as any)[key];
    }
  });

  // Merge provider-specific generation options if available
  if (normalizedInput.providerOptions?.openai) {
    return {
      ...baseParams,
      ...normalizedInput.providerOptions.openai,
    };
  }

  return baseParams;
}

/**
 * Convert OpenAI ChatCompletion to ModelOutput
 */
async function processOutput(output: ChatCompletion): Promise<ModelOutput> {
  const choice = output.choices?.[0];
  const openaiMessage = choice?.message;

  if (!openaiMessage) {
    throw new Error('No message in OpenAI response');
  }

  const content: ContentBlock[] = [];

  // Add text content
  if (openaiMessage.content) {
    content.push({
      type: 'text',
      text: openaiMessage.content,
    });
  }

  // Extract tool calls
  const toolCalls: any[] = [];
  if (openaiMessage.tool_calls) {
    for (const toolCall of openaiMessage.tool_calls) {
      if (toolCall.type === 'function' && 'function' in toolCall) {
        let parsedInput: any;
        try {
          parsedInput = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          parsedInput = toolCall.function.arguments as any;
        }

        toolCalls.push({
          id: toolCall.id,
          name: toolCall.function.name,
          input: parsedInput,
        });

        // Add tool_use block to content
        content.push({
          type: 'tool_use',
          tool_use_id: toolCall.id,
          name: toolCall.function.name,
          input: parsedInput,
        });
      }
    }
  }

  const messages: Message[] = [{
    role: 'assistant',
    content,
  }];

  return {
    model: output.model,
    createdAt: output.created.toString(),
    messages: messages,
    get message() {
      return messages.filter(message => message.role === 'assistant').at(-1);
    },
    stopReason: choice?.finish_reason
      ? STOP_REASON_MAP[choice.finish_reason] ?? StopReason.OTHER
      : StopReason.UNSPECIFIED,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      inputTokens: output.usage?.prompt_tokens ?? 0,
      outputTokens: output.usage?.completion_tokens ?? 0,
      totalTokens: output.usage?.total_tokens ?? 0,
      reasoningTokens: 0,
      cachedInputTokens: output.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
    raw: output,
  };
}

/**
 * Convert OpenAI ChatCompletionChunk to StreamChunk
 */
function processChunk(chunk: ChatCompletionChunk): StreamChunk {
  const choice = chunk.choices[0];
  if (!choice) {
    return {
      type: 'content_delta',
      delta: '',
      raw: chunk,
    };
  }

  const delta = choice.delta;
  if (!delta) {
    return {
      type: 'content_delta',
      delta: '',
      raw: chunk,
    };
  }

  // Skip finish_reason chunks (handled in processStream)
  if (choice.finish_reason) {
    return {
      type: 'content_delta',
      delta: '',
      raw: chunk,
    };
  }

  // Content delta
  if (delta.content !== undefined && delta.content) {
    return {
      type: 'content_delta',
      delta: delta.content,
      model: chunk.model,
      createdAt: chunk.created.toString(),
      raw: chunk,
    };
  }

  // Tool calls are handled in processStream, not streamed incrementally
  // Return empty delta for now
  return {
    type: 'content_delta',
    delta: '',
    raw: chunk,
  };
}

/**
 * Aggregate stream chunks into final ModelOutput
 */
async function processStreamChunks(chunks: ChatCompletionChunk[] | StreamChunk[]): Promise<ModelOutput> {
  if (chunks.length === 0) {
    throw new Error('No chunks to process');
  }

  // Check if chunks are StreamChunks (from engine) or ChatCompletionChunks (raw from provider)
  const isStreamChunk = (chunk: any): chunk is StreamChunk => {
    return chunk && typeof chunk === 'object' && 'type' in chunk && !('choices' in chunk);
  };

  // If StreamChunks, we need to reconstruct from raw data
  if (isStreamChunk(chunks[0])) {
    // Chunks are StreamChunks - extract raw ChatCompletionChunk from raw property
    const openaiChunks = chunks
      .map((c) => (c as StreamChunk).raw)
      .filter((c) => c && typeof c === 'object' && 'choices' in c) as ChatCompletionChunk[];

    if (openaiChunks.length === 0) {
      throw new Error('No valid OpenAI chunks found in stream chunks');
    }

    return processStreamChunks(openaiChunks); // Recursively process as ChatCompletionChunks
  }

  // Chunks are ChatCompletionChunks (raw from provider)
  const openaiChunks = chunks as ChatCompletionChunk[];
  const firstChunk = openaiChunks[0];
  const lastChunk = openaiChunks[openaiChunks.length - 1];

  // Find chunk with usage information
  const usageChunk = openaiChunks.find((chunk) => chunk.usage) || lastChunk;

  // Accumulate content
  let accumulatedContent = '';
  const toolCallsMap = new Map<number, any>();
  let finishReason: string | null = null;

  for (const chunk of openaiChunks) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta;
    if (delta?.content) {
      accumulatedContent += delta.content;
    }

    if (delta?.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index ?? 0;
        const existing = toolCallsMap.get(index) || {};

        toolCallsMap.set(index, {
          ...existing,
          ...toolCallDelta,
          function: toolCallDelta.function
            ? {
                ...existing.function,
                ...toolCallDelta.function,
                arguments: (existing.function?.arguments || '') + (toolCallDelta.function.arguments || ''),
              }
            : existing.function,
        });
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  // Build message content
  // Trim trailing whitespace (models often emit newlines before tool calls)
  const content: ContentBlock[] = [];
  const trimmedContent = accumulatedContent.trimEnd();
  if (trimmedContent) {
    content.push({ type: 'text', text: trimmedContent });
  }

  // Convert tool calls
  const toolCalls: any[] = [];
  if (toolCallsMap.size > 0) {
    for (const tc of toolCallsMap.values()) {
      let parsedInput: any;
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch {
        parsedInput = tc.function.arguments;
      }

      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      });

      content.push({
        type: 'tool_use',
        tool_use_id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      });
    }
  }

  const messages: Message[] = [{
    role: 'assistant',
    content,
  }];

  return {
    model: firstChunk.model,
    createdAt: firstChunk.created.toString(),
    messages: messages,
    get message() {
      return messages.filter(message => message.role === 'assistant').at(-1);
    },
    stopReason: finishReason ? (STOP_REASON_MAP[finishReason] ?? StopReason.OTHER) : StopReason.UNSPECIFIED,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      inputTokens: usageChunk.usage?.prompt_tokens ?? 0,
      outputTokens: usageChunk.usage?.completion_tokens ?? 0,
      totalTokens: usageChunk.usage?.total_tokens ?? 0,
      reasoningTokens: 0,
      cachedInputTokens: usageChunk.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
    raw: openaiChunks,
  };
}

// ============================================================================
// Executor Functions
// ============================================================================

/**
 * Execute non-streaming request
 */
async function execute(
  client: OpenAI,
  input: OpenAI.Chat.Completions.ChatCompletionCreateParams
): Promise<ChatCompletion> {
  return await client.chat.completions.create(
    { ...input, stream: false } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
  );
}

/**
 * Execute streaming request
 */
async function* executeStream(
  client: OpenAI,
  input: OpenAI.Chat.Completions.ChatCompletionCreateParams
): AsyncIterable<ChatCompletionChunk> {
  // DEBUG: Log what we're sending to OpenAI
  logger.debug('\n🔧 [OpenAI] executeStream - tools:', input.tools?.map((t: any) => t.function.name));
  logger.debug('🔧 [OpenAI] executeStream - message count:', input.messages.length);
  logger.debug('🔧 [OpenAI] executeStream - full request:', JSON.stringify(input, null, 2));
  
  const stream = await client.chat.completions.create(
    { ...input, stream: true, stream_options: { include_usage: true } } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
  );

  let hasToolCalls = false;
  for await (const chunk of stream) {
    // DEBUG: Check if any chunk has tool_calls
    if (chunk.choices?.[0]?.delta?.tool_calls) {
      hasToolCalls = true;
      logger.debug('🔧 [OpenAI] TOOL CALL CHUNK:', JSON.stringify(chunk.choices[0].delta.tool_calls, null, 2));
    }
    if (chunk.choices?.[0]?.finish_reason) {
      logger.debug('🔧 [OpenAI] finish_reason:', chunk.choices[0].finish_reason, 'hasToolCalls:', hasToolCalls);
    }
    yield chunk;
  }
}
