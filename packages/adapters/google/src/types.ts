import { type GenerateContentParameters, GoogleGenAI } from "@google/genai";
import { type ProviderClientOptions, StopReason } from "aidk";

/**
 * Google-specific client initialization options.
 */
export interface GoogleClientOptions {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  timeout?: number;
  baseUrl?: string;
  googleAuthOptions?: {
    keyFilename?: string;
    keyFile?: string;
    credentials?: any;
    clientOptions?: any;
    scopes?: string[];
    projectId?: string;
    universeDomain?: string;
  };
  [key: string]: unknown;
}

/**
 * Google-specific generation options.
 */
export type GoogleGenerationOptions = Partial<GenerateContentParameters> & {
  [key: string]: unknown;
};

/**
 * Google-specific tool options.
 */
export interface GoogleToolOptions {
  functionDeclarations?: Array<{
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Module augmentation: Extend provider option interfaces to include Google-specific options.
 */
declare module 'aidk' {
  interface ProviderClientOptions {
    google?: GoogleClientOptions;
  }

  interface ProviderGenerationOptions {
    google?: GoogleGenerationOptions;
  }

  interface ProviderToolOptions {
    google?: GoogleToolOptions;
  }
}

export interface GoogleAdapterConfig {
  apiKey?: string;
  vertexai?: boolean;
  project?: string;
  location?: string;
  timeout?: number;
  baseUrl?: string;
  googleAuthOptions?: GoogleClientOptions['googleAuthOptions'];
  model?: string; // Default model to use if not specified in ModelInput
  client?: GoogleGenAI;
  providerOptions?: ProviderClientOptions;
}

export const STOP_REASON_MAP: Record<string, StopReason> = {
  stop: StopReason.STOP,
  length: StopReason.MAX_TOKENS,
  content_filter: StopReason.CONTENT_FILTER,
  tool_calls: StopReason.TOOL_USE,
  function_call: StopReason.FUNCTION_CALL,
};
