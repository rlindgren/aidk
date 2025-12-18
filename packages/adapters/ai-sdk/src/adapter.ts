/**
 * AI SDK Adapter
 * 
 * Wraps Vercel AI SDK models for use with the engine.
 * Supports any LanguageModel from AI SDK providers (OpenAI, Anthropic, Google, etc.)
 */

import { 
  type AudioBlock, 
  type ContentBlock, 
  type DocumentBlock, 
  type ImageBlock, 
  type ReasoningBlock, 
  type TextBlock, 
  type ToolResultBlock, 
  type VideoBlock, 
  type ToolUseBlock, 
  type JsonBlock,
  type MediaBlock,
  type Message,
  type StreamChunk,
  StopReason, 
  StreamChunkType,
  BlockType,
  bufferToBase64Source,
  isUrlString,
} from 'aidk/content';

import type {
  ModelInput, 
  ModelOutput,
  ModelToolReference, 
} from 'aidk/model';

import {
  type LibraryGenerationOptions,
  type EngineModel,
  createLanguageModel,
  type ProviderToolOptions,
  Logger,
} from 'aidk';

import type {
  ToolDefinition,
  ExecutableTool
} from 'aidk/tool';

import { mergeDeep } from 'aidk/utils';

import { 
  generateText, 
  streamText, 
  type ModelMessage, 
  type ToolSet, 
  type GenerateTextResult, 
  type ToolResultPart, 
  type ToolCallPart, 
  type FilePart, 
  type ImagePart, 
  type TextPart, 
  type AssistantContent, 
  type ToolContent, 
  type ReasoningUIPart, 
  type FinishReason,
  type LanguageModel,
  jsonSchema,
  type Tool
} from 'ai';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for the AI SDK adapter
 */
export interface AiSdkAdapterConfig {
  /** The AI SDK language model instance */
  model: LanguageModel;
  /** Default system prompt */
  system?: string;
  /** Default tools (AI SDK ToolSet format) */
  tools?: ToolSet;
  /** Temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Top P sampling */
  topP?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
  /** Presence penalty */
  presencePenalty?: number;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

// Module augmentation for type safety
declare module 'aidk' {
  interface LibraryGenerationOptions {
    'ai-sdk'?: Partial<Parameters<typeof generateText>[0]>;
  }

  interface LibraryToolOptions {
    'ai-sdk'?: Partial<Tool>;
  }
}

export type AiSdkAdapter = EngineModel<ModelInput, ModelOutput>;

const logger = Logger.for('AiSdkAdapter');

// ============================================================================
// Stop Reason Mapping
// ============================================================================

function toStopReason(reason: FinishReason): StopReason {
  switch (reason) {
    case 'length':
      return StopReason.MAX_TOKENS;
    case 'other':
      return StopReason.OTHER;
    case 'stop':
      return StopReason.STOP;
    case 'content-filter':
      return StopReason.CONTENT_FILTER;
    case 'tool-calls':
      return StopReason.TOOL_USE;
    case 'error':
      return StopReason.ERROR;
    default:
      return StopReason.UNSPECIFIED;
  }
}

/**
 * Convert ModelToolReference[] to AI SDK ToolSet format.
 * Tools are passed as definitions only - engine handles execution.
 */
function convertToolsToToolSet(tools?: ModelToolReference[]): ToolSet {
  if (!tools || tools.length === 0) {
    return {} as ToolSet;
  }

  const toolSet: ToolSet = {} as ToolSet;

  for (const toolRef of tools) {
    if (typeof toolRef === 'string') {
      logger.warn(`🚨 Tool reference ${toolRef} is a string, skipping`);
      // String reference - can't resolve without registry, skip
      continue;
    } else if ('metadata' in toolRef && 'run' in toolRef) {
      const toolDef = toolRef as ExecutableTool;

      const libraryOptions = toolDef.metadata?.libraryOptions || {};
      const libraryProviderOptions = libraryOptions['ai-sdk']?.providerOptions || {};
      const providerOptions = mergeDeep<ProviderToolOptions>({}, toolDef.metadata.providerOptions || {}, libraryProviderOptions || {});

      // ExecutableTool - engine will execute these
      toolSet[toolDef.metadata.name] = {
        description: toolDef.metadata.description || '',
        inputSchema: toolDef.metadata.parameters, // zod schema already
        ...libraryOptions,
        providerOptions,
        // No execute - engine handles execution
      } as any;
    } else if ('name' in toolRef && 'parameters' in toolRef) {
      const toolDef = toolRef as ToolDefinition;
      const libraryOptions = toolDef.libraryOptions || {};
      const libraryProviderOptions = libraryOptions['ai-sdk']?.providerOptions || {};
      const providerOptions = mergeDeep<ProviderToolOptions>({}, toolDef.providerOptions || {}, libraryProviderOptions || {});
      // ToolDefinition - engine will execute these
      
      toolSet[toolDef.name] = {
        description: toolDef.description || '',
        inputSchema: jsonSchema(toolDef.parameters || {}),
        ...libraryOptions,
        providerOptions,
        // No execute - engine handles execution
      } as any;
    }
  }

  return toolSet;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an AI SDK adapter for use with the engine.
 * 
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * 
 * const model = createAiSdkModel({
 *   model: openai('gpt-4o'),
 *   temperature: 0.7,
 * });
 * ```
 */
export function createAiSdkModel(config: AiSdkAdapterConfig): AiSdkAdapter {
  const { model, system: defaultSystem, tools: defaultTools, ...defaultParams } = config;

  return createLanguageModel<ModelInput, ModelOutput, Parameters<typeof generateText>[0], Awaited<ReturnType<typeof generateText>>, any>({
    metadata: { 
      id: `ai-sdk:${(model as any).modelId || 'unknown'}`, 
      provider: (model as any).provider || 'ai-sdk', 
      type: 'language', 
      capabilities: [
        { stream: true, toolCalls: true },
        {
          // Dynamic function that inspects the underlying model
          messageTransformation: (modelId: string, provider?: string) => {
            // Determine renderer based on model ID
            const preferredRenderer = 'markdown'; // Most AI SDK models work best with markdown
            
            // Determine role mapping based on provider/model
            const supportsDeveloper = provider === 'anthropic' || 
                                     (provider === 'openai' && (modelId.startsWith('gpt-4') || modelId.startsWith('o1') || modelId.startsWith('gpt-5')));
            
            return {
              preferredRenderer,
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
      ] 
    },
    
    transformers: {
      prepareInput: (input) => {
        const { libraryOptions = {}, providerOptions = {}, ...params } = input;
        const sdkOptions = (libraryOptions as LibraryGenerationOptions['ai-sdk']) || {};
        const { tools: adapterTools, system: adapterSystem, ...restOfLibraryOptions } = sdkOptions;
        
        // Ensure messages is Message[]
        const messages = Array.isArray(params.messages) 
          ? params.messages.filter((m): m is Message => typeof m !== 'string')
          : [];
        
        const aiSdkMessages = toAiSdkMessages(messages, adapterSystem, defaultSystem);
        
        // Merge tools: default -> adapter -> input
        const inputToolSet = convertToolsToToolSet(params.tools);
        const mergedTools: ToolSet = { 
          ...defaultTools, 
          ...(adapterTools || {}), 
          ...inputToolSet 
        } as ToolSet;

        return {
          model,
          tools: Object.keys(mergedTools).length > 0 ? mergedTools : undefined,
          messages: aiSdkMessages,
          temperature: params.temperature ?? defaultParams.temperature,
          maxOutputTokens: params.maxTokens ?? defaultParams.maxTokens,
          topP: params.topP ?? defaultParams.topP,
          frequencyPenalty: params.frequencyPenalty ?? defaultParams.frequencyPenalty,
          presencePenalty: params.presencePenalty ?? defaultParams.presencePenalty,
          ...restOfLibraryOptions,
          providerOptions: {
            ...defaultParams.providerOptions,
            ...providerOptions,
            ...(sdkOptions.providerOptions || {}),
          },
        } as unknown as Parameters<typeof generateText>[0];
      },
      
      processOutput: (output) => {
        const messages = fromAiSdkMessages(output.response.messages) ?? [];
        const result = {
          messages,
          get message() {
            return messages.filter(msg => msg.role === 'assistant').at(-1);
          },
          usage: {
            inputTokens: output.usage?.inputTokens ?? 0,
            outputTokens: output.usage?.outputTokens ?? 0,
            totalTokens: output.usage?.totalTokens ?? 0,
            reasoningTokens: (output.usage as any)?.reasoningTokens ?? 0,
            cachedInputTokens: (output.usage as any)?.cachedInputTokens ?? 0,
          },
          toolCalls: output.toolCalls?.map(toolCall => {
            return {
              id: toolCall.toolCallId,
              name: toolCall.toolName,
              input: (toolCall as any).args || (toolCall as any).input || {},
              metadata: (toolCall as any).providerMetadata,
              executedBy: (toolCall as any).providerExecuted ? 'provider' : undefined,
            };
          }) || [],
          stopReason: toStopReason(output.finishReason),
          model: output.response.modelId,
          createdAt: output.response.timestamp.toISOString(),
          raw: output,
        };

        return result;
      },
      
      processChunk: (chunk: any): StreamChunk => {
        // AI SDK TextStreamPart types - see ai/dist/index.d.ts
        switch (chunk.type) {
          // Text content
          case 'text-start':
            return { type: 'content_start', id: chunk.id };
          case 'text-delta':
            return { type: 'content_delta', id: chunk.id, delta: chunk.text || '' };
          case 'text-end':
            return { type: 'content_end', id: chunk.id };
            
          // Reasoning/thinking
          case 'reasoning-start':
            return { type: 'reasoning_start', reasoningId: chunk.id };
          case 'reasoning-delta':
            return { type: 'reasoning_delta', reasoningId: chunk.id, reasoning: chunk.text || '' };
          case 'reasoning-end':
            return { type: 'reasoning_end', reasoningId: chunk.id };
            
          // Tool calls
          case 'tool-input-start':
            return { 
              type: StreamChunkType.TOOL_INPUT_START, 
              id: chunk.id, 
              blockType: BlockType.TOOL_USE,
              raw: { toolName: chunk.toolName, providerExecuted: chunk.providerExecuted }
            };
          case 'tool-input-delta':
            // Tool input streaming - mark with blockType so handler knows it's not text
            return { 
              type: StreamChunkType.TOOL_INPUT_DELTA, 
              id: chunk.id, 
              delta: chunk.delta,
              blockType: BlockType.TOOL_USE,
            };
          case 'tool-input-end':
            return { type: StreamChunkType.TOOL_INPUT_END, id: chunk.id, blockType: BlockType.TOOL_USE };
          case 'tool-call':
            return {
              type: 'tool_call',
              toolCalls: [{
                id: chunk.toolCallId,
                name: chunk.toolName,
                input: (chunk as any).args || (chunk as any).input || {},
              }],
            };
          case 'tool-result':
            // Provider-executed tool result (web search, code execution, etc.)
            return {
              type: StreamChunkType.TOOL_RESULT,
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              toolResult: chunk.result,
              providerExecuted: true,
            };
          case 'tool-error':
            return {
              type: 'error',
              raw: { type: 'tool_error', toolCallId: chunk.toolCallId, error: chunk.error },
            };
            
          // Sources and files
          case 'source':
            return { type: 'content_delta', delta: '', raw: { type: 'source', ...chunk } };
          case 'file':
            return { type: 'content_delta', delta: '', raw: { type: 'file', file: chunk.file } };
            
          // Step lifecycle
          case 'start-step':
            return { 
              type: StreamChunkType.STEP_START,
              stepRequest: chunk.request,
              stepWarnings: chunk.warnings || [],
            };
          case 'finish-step':
            return {
              type: StreamChunkType.STEP_END,
              stepResponse: chunk.response,
              usage: chunk.usage ? {
                inputTokens: chunk.usage.promptTokens ?? 0,
                outputTokens: chunk.usage.completionTokens ?? 0,
                totalTokens: (chunk.usage.promptTokens ?? 0) + (chunk.usage.completionTokens ?? 0),
              } : undefined,
              stopReason: toStopReason(chunk.finishReason),
            };
            
          // Stream lifecycle
          case 'start':
            return { type: 'message_start' };
          case 'finish':
            return {
              type: 'message_end',
              stopReason: toStopReason(chunk.finishReason),
              usage: chunk.totalUsage ? {
                inputTokens: chunk.totalUsage.promptTokens ?? 0,
                outputTokens: chunk.totalUsage.completionTokens ?? 0,
                totalTokens: (chunk.totalUsage.promptTokens ?? 0) + (chunk.totalUsage.completionTokens ?? 0),
              } : undefined,
            };
          case 'abort':
            return { type: 'error', raw: { type: 'abort' } };
          case 'error':
            return { type: 'error', raw: { type: 'error', error: chunk.error } };
          case 'raw':
            return { type: 'content_delta', delta: '', raw: chunk.rawValue };
            
          default:
            // Unknown chunk type
            return { type: 'content_delta', delta: '', raw: chunk };
        }
      },
      
      processStream: async (chunks: StreamChunk[]) => {
        // Aggregate stream chunks into ModelOutput
        let text = '';
        let reasoning = '';
        const toolCalls: any[] = [];
        let stopReason: StopReason = StopReason.UNSPECIFIED;
        let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        
        for (const chunk of chunks) {
          if (chunk.type === StreamChunkType.CONTENT_DELTA) {
            text += chunk.delta;
          }
          if (chunk.reasoning) {
            reasoning += chunk.reasoning;
          }
          if (chunk.toolCalls) {
            toolCalls.push(...chunk.toolCalls);
          }
          if (chunk.stopReason) {
            stopReason = chunk.stopReason;
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
        
        const content: ContentBlock[] = [];
        // Add reasoning block first if present
        if (reasoning) {
          content.push({ type: 'reasoning', text: reasoning } as ContentBlock);
        }
        if (text) {
          content.push({ type: 'text', text });
        }
        for (const tc of toolCalls) {
          content.push({
            type: 'tool_use',
            tool_use_id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
        
        const messages: Message[] = [{
          role: 'assistant',
          content,
        }];
        
        return {
          messages,
          get message() {
            return messages[0];
          },
          usage,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          stopReason,
          model: (model as any).modelId || 'unknown',
          createdAt: new Date().toISOString(),
          raw: chunks,
        };
      },
    },
    
    executors: {
      execute: (params) => {
        logger.info({ params }, 'execute');
        return generateText(params);
      },
      executeStream: (params) => {
        logger.info({ params }, 'executeStream');
        return streamText(params).fullStream;
      },
    },
  });
}

/**
 * Shorthand factory for creating AI SDK adapter.
 * 
 * @example
 * ```typescript
 * import { openai } from '@ai-sdk/openai';
 * 
 * const model = aiSdk({ model: openai('gpt-4o') });
 * ```
 */
export function aiSdk(config: AiSdkAdapterConfig): AiSdkAdapter {
  return createAiSdkModel(config);
}

// ============================================================================
// Message Conversion
// ============================================================================

function toAiSdkMessages(messages: Message[], adapterSystemPrompt: string = '', defaultSystem?: string): ModelMessage[] {
  let system: string | undefined;
  const modelMessages: ModelMessage[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') {
      // Extract system message
      system = msg.content
        .filter((block): block is TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n\n');
    } else if (msg.role === 'tool') {
      // Tool role messages - extract tool_result blocks
      const toolResults = msg.content
        .filter((block): block is ToolResultBlock => block.type === 'tool_result')
        .map(block => ({
          type: 'tool-result' as const,
          toolCallId: block.tool_use_id,
          toolName: block.name || 'unknown',
          output: mapToolResultContent(block.content, block.is_error),
        }));
      
      if (toolResults.length > 0) {
        modelMessages.push({
          role: 'tool',
          content: toolResults,
        } as any);
      }
    } else {
      // By this point, fromEngineState should have transformed 'event' to 'user'
      // and ephemeral content has been interleaved as regular messages.
      // This is a safety fallback in case adapter is used directly.
      const role = msg.role === 'event' ? 'user' : msg.role;
      if (role === 'user' || role === 'assistant') {
        const content = mapContentBlocksToAiSdkContent(msg.content);
        // Skip messages with empty content - these confuse the model
        if (content.length > 0) {
          modelMessages.push({
            role,
            content: content as any,
          });
        }
      }
    }
  }

  system = system || adapterSystemPrompt || defaultSystem;
  if (system) {
    modelMessages.unshift({
      role: 'system' as const,
      content: system
    });
  }
  return modelMessages;
}

/**
 * Convert tool result content blocks to AI SDK LanguageModelV2ToolResultOutput format.
 * 
 * The output must be one of:
 * - { type: 'text', value: string }
 * - { type: 'json', value: JSONValue }
 * - { type: 'error-text', value: string }
 * - { type: 'error-json', value: JSONValue }
 * - { type: 'content', value: Array<{ type: 'text', text: string } | { type: 'media', data: string, mediaType: string }> }
 */
function mapToolResultContent(content: ContentBlock[], isError?: boolean): { type: string; value: unknown } {
  if (!content || content.length === 0) {
    return isError 
      ? { type: 'error-text', value: 'Tool execution failed' } 
      : { type: 'text', value: 'Tool execution succeeded' };
  }
  
  // Single text block
  if (content.length === 1 && content[0].type === 'text') {
    const text = (content[0] as TextBlock).text;
    return isError ? { type: 'error-text', value: text } : { type: 'text', value: text };
  }
  
  // Single JSON block
  if (content.length === 1 && content[0].type === 'json') {
    const jsonBlock = content[0] as JsonBlock;
    const data = jsonBlock.data ?? JSON.parse(jsonBlock.text);
    return isError ? { type: 'error-json', value: data } : { type: 'json', value: data };
  }
  
  // Multiple blocks → use 'content' type with array
  return {
    type: 'content',
    value: content.map(block => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: (block as TextBlock).text };
      } else if (block.type === 'json') {
        const jsonBlock = block as JsonBlock;
        return { type: 'text' as const, text: jsonBlock.text };
      } else if (block.type === 'image') {
        const mediaBlock = block as MediaBlock;
        if (mediaBlock.source.type === 'base64') {
          return { type: 'media' as const, data: mediaBlock.source.data, mediaType: mediaBlock.mime_type || 'image/png' };
        } else if (mediaBlock.source.type === 'url') {
          return { type: 'text' as const, text: mediaBlock.source.url };
        } else if (mediaBlock.source.type === 's3') {
          return { type: 'text' as const, text: `s3://${mediaBlock.source.bucket}/${mediaBlock.source.key}` };
        } else if (mediaBlock.source.type === 'gcs') {
          return { type: 'text' as const, text: `gs://${mediaBlock.source.bucket}/${mediaBlock.source.object}` };
        }
        // URL images fallback to text
        return { type: 'text' as const, text: `file_id:${mediaBlock.source.file_id}` };
      }
      // Fallback: serialize as text
      return { type: 'text' as const, text: JSON.stringify(block) };
    })
  };
}

function fromAiSdkMessages(messages: GenerateTextResult<ToolSet, unknown>['response']['messages'] | undefined): Message[] {
  if (!messages || messages.length === 0) {
    return []; // Return empty array - no fake empty assistant messages
  }
  
  return messages
    .map(msg => ({
      role: msg.role as Message['role'],
      content: mapAiSdkContentToContentBlocks(msg.content),
    }))
    .filter((msg): msg is Message => msg.content.length > 0); // Only keep messages with content
}

// ============================================================================
// Content Block Conversion: Engine → AI SDK
// ============================================================================

function mapContentBlocksToAiSdkContent(
  content: ContentBlock[]
): (TextPart | ImagePart | FilePart | ReasoningUIPart | ToolCallPart | ToolResultPart)[] {
  return content
    .map(block => mapContentBlockToAiSdkPart(block))
    .filter((part): part is NonNullable<typeof part> => part !== undefined);
}

function mapContentBlockToAiSdkPart(
  block: ContentBlock
): TextPart | ImagePart | FilePart | ReasoningUIPart | ToolCallPart | ToolResultPart | undefined {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
      
    case 'reasoning':
      return { type: 'reasoning', text: (block as ReasoningBlock).text } as ReasoningUIPart;
      
    case 'image': {
      const imageBlock = block as ImageBlock;
      const source = imageBlock.source;
      if (source.type === 'url') {
        return { type: 'image', image: source.url, mediaType: imageBlock.mime_type } as ImagePart;
      } else if (source.type === 'base64') {
        return { type: 'image', image: source.data, mediaType: imageBlock.mime_type } as ImagePart;
      }
      return undefined;
    }
    
    case 'document': {
      const docBlock = block as DocumentBlock;
      const source = docBlock.source;
      if (source.type === 'url') {
        return { type: 'file', data: source.url, mediaType: docBlock.mime_type } as FilePart;
      } else if (source.type === 'base64') {
        return { type: 'file', data: source.data, mediaType: docBlock.mime_type } as FilePart;
      }
      return undefined;
    }
    
    case 'audio': {
      const audioBlock = block as AudioBlock;
      const source = audioBlock.source;
      if (source.type === 'url') {
        return { type: 'file', data: source.url, mediaType: audioBlock.mime_type } as FilePart;
      } else if (source.type === 'base64') {
        return { type: 'file', data: source.data, mediaType: audioBlock.mime_type } as FilePart;
      }
      return undefined;
    }
    
    case 'video': {
      const videoBlock = block as VideoBlock;
      const source = videoBlock.source;
      if (source.type === 'url') {
        return { type: 'file', data: source.url, mediaType: videoBlock.mime_type } as FilePart;
      } else if (source.type === 'base64') {
        return { type: 'file', data: source.data, mediaType: videoBlock.mime_type } as FilePart;
      }
      return undefined;
    }
    
    case 'tool_use': {
      const toolUseBlock = block as ToolUseBlock;
      return {
        type: 'tool-call',
        toolCallId: toolUseBlock.tool_use_id,
        toolName: toolUseBlock.name,
        input: toolUseBlock.input,
      } as unknown as ToolCallPart;
    }
    
    case 'tool_result': {
      const toolResultBlock = block as ToolResultBlock;
      return {
        type: 'tool-result',
        toolCallId: toolResultBlock.tool_use_id,
        toolName: toolResultBlock.name,
        output: mapContentBlocksToToolResultOutput(toolResultBlock.content, toolResultBlock.is_error),
      } as unknown as ToolResultPart;
    }
    
    default:
      // Unexpected block type - convert to text as fallback
      // This should rarely happen if fromEngineState is working correctly,
      // but provides graceful degradation for unexpected types
      const blockType = (block as any).type || 'unknown';
      const blockText = (block as any).text || JSON.stringify(block, null, 2);
      logger.warn(`[AI SDK Adapter] Unexpected block type "${blockType}" - converting to text. This should have been converted by fromEngineState.`);
      return { type: 'text', text: blockText };
  }
}

/**
 * Convert ContentBlock[] to LanguageModelV2ToolResultOutput format.
 * Used in mapContentBlockToAiSdkPart for tool_result blocks.
 */
function mapContentBlocksToToolResultOutput(content: ContentBlock[], isError?: boolean): ToolResultPart['output'] {
  // Empty content
  if (!content || content.length === 0) {
    return isError 
      ? { type: 'error-text' as const, value: 'Tool execution failed' } 
      : { type: 'text' as const, value: 'Tool execution succeeded' };
  }
  
  // Single text block
  if (content.length === 1 && content[0].type === 'text') {
    const text = content[0].text;
    return isError 
      ? { type: 'error-text' as const, value: text }
      : { type: 'text' as const, value: text };
  }
  
  // Single JSON block
  if (content.length === 1 && content[0].type === 'json') {
    const jsonBlock = content[0] as JsonBlock;
    const data = jsonBlock.data || JSON.parse(jsonBlock.text);
    return isError
      ? { type: 'error-json' as const, value: data }
      : { type: 'json' as const, value: data };
  }
  
  // Multiple blocks → use 'content' type
  return {
    type: 'content' as const,
    value: content.map(block => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      } else if (block.type === 'json') {
        const jsonBlock = block as JsonBlock;
        return { type: 'text' as const, text: jsonBlock.text };
      } else if (block.type === 'image') {
        const mediaBlock = block as MediaBlock;
        if (mediaBlock.source.type === 'base64') {
          return { type: 'media' as const, data: mediaBlock.source.data, mediaType: mediaBlock.mime_type || 'image/png' };
        } else if (mediaBlock.source.type === 'url') {
          return { type: 'text' as const, text: mediaBlock.source.url };
        } else if (mediaBlock.source.type === 's3') {
          return { type: 'text' as const, text: `s3://${mediaBlock.source.bucket}/${mediaBlock.source.key}` };
        } else if (mediaBlock.source.type === 'gcs') {
          return { type: 'text' as const, text: `gs://${mediaBlock.source.bucket}/${mediaBlock.source.object}` };
        }
        // URL images fallback to text
        return { type: 'text' as const, text: `file_id:${mediaBlock.source.file_id}` };
      }
      // Fallback: serialize as text
      return { type: 'text' as const, text: JSON.stringify(block) };
    })
  };
}

// ============================================================================
// Content Block Conversion: AI SDK → Engine
// ============================================================================

function mapAiSdkContentToContentBlocks(content: AssistantContent | ToolContent): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return content
    .map(mapAiSdkPartToContentBlock)
    .filter((block): block is ContentBlock => block !== undefined);
}

function mapAiSdkPartToContentBlock(
  part: TextPart | ImagePart | FilePart | ReasoningUIPart | ToolCallPart | ToolResultPart
): ContentBlock | undefined {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text } as TextBlock;
      
    case 'reasoning':
      return { type: 'reasoning', text: part.text } as ReasoningBlock;
      
    case 'image': {
      const imageData = part.image;
      
      if (typeof imageData === 'string') {
        return {
          type: 'image',
          source: isUrlString(imageData) 
            ? { type: 'url', url: imageData }
            : { type: 'base64', data: imageData },
          mime_type: part.mediaType,
        } as ImageBlock;
      } else if (imageData instanceof Uint8Array || Buffer.isBuffer(imageData)) {
        return {
          type: 'image',
          source: bufferToBase64Source(imageData, part.mediaType),
        } as ImageBlock;
      }
      return undefined;
    }
    
    case 'file': {
      const fileData = part.data;
      
      if (typeof fileData === 'string') {
        return {
          type: 'document',
          source: isUrlString(fileData)
            ? { type: 'url', url: fileData }
            : { type: 'base64', data: fileData },
          mime_type: part.mediaType,
        } as DocumentBlock;
      } else if (fileData instanceof Uint8Array || Buffer.isBuffer(fileData)) {
        return {
          type: 'document',
          source: bufferToBase64Source(fileData, part.mediaType),
        } as DocumentBlock;
      }
      return undefined;
    }
    
    case 'tool-call':
      return {
        type: 'tool_use',
        tool_use_id: part.toolCallId,
        name: part.toolName,
        input: (part as any).args || (part as any).input || {},
      } as ToolUseBlock;
      
    case 'tool-result': {
      const output = (part as any).output || (part as any).result;
      return {
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        name: part.toolName,
        content: mapToolResultToContentBlocks(output),
        is_error: typeof output === 'object' && output !== null && 'error' in output,
      } as ToolResultBlock;
    }
      
    default:
      return undefined;
  }
}

function mapToolResultToContentBlocks(result: any): ContentBlock[] {
  if (result === undefined || result === null) {
    return [{ type: 'text', text: '[No result]' }];
  }
  
  if (typeof result === 'string') {
    return [{ type: 'text', text: result }];
  }
  
  if (Array.isArray(result)) {
    const blocks: ContentBlock[] = [];
    for (const item of result) {
      if (typeof item === 'string') {
        blocks.push({ type: 'text', text: item } as TextBlock);
      } else if (item && typeof item === 'object' && 'type' in item) {
        if (item.type === 'text' && 'text' in item) {
          blocks.push({ type: 'text', text: item.text } as TextBlock);
        } else if (item.type === 'image' && 'data' in item) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', data: item.data },
            mime_type: (item as any).mediaType || 'image/png',
          } as ImageBlock);
        } else {
          // Unknown type, serialize as JSON
          blocks.push({ type: 'json', text: JSON.stringify(item), data: item } as JsonBlock);
        }
      } else {
        // Fallback: serialize as JSON
        blocks.push({ type: 'json', text: JSON.stringify(item), data: item } as JsonBlock);
      }
    }
    return blocks;
  }
  
  // Object result → JSON block
  return [{ type: 'json', text: JSON.stringify(result), data: result } as JsonBlock];
}
