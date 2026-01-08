/**
 * Cost estimation for AI model usage
 *
 * Prices are per 1M tokens, sourced from public pricing as of early 2025.
 * These are estimates and may not reflect actual billing.
 */

interface ModelPricing {
  inputPer1M: number; // $ per 1M input tokens
  outputPer1M: number; // $ per 1M output tokens
  cachedPer1M?: number; // $ per 1M cached input tokens (if different)
}

// Known model pricing (approximate, may vary by region/tier)
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  "claude-3-opus": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-3-5-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-sonnet": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "claude-opus-4": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-sonnet-4": { inputPer1M: 3.0, outputPer1M: 15.0 },

  // OpenAI GPT-4
  "gpt-4-turbo": { inputPer1M: 10.0, outputPer1M: 30.0 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4": { inputPer1M: 30.0, outputPer1M: 60.0 },
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  o1: { inputPer1M: 15.0, outputPer1M: 60.0 },
  "o1-mini": { inputPer1M: 3.0, outputPer1M: 12.0 },

  // Google
  "gemini-1.5-pro": { inputPer1M: 3.5, outputPer1M: 10.5 },
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },

  // Default fallback (conservative estimate)
  default: { inputPer1M: 5.0, outputPer1M: 15.0 },
};

/**
 * Find pricing for a model by matching against known models
 */
function findModelPricing(modelId: string): ModelPricing {
  const normalizedId = modelId.toLowerCase();

  // Direct match
  if (MODEL_PRICING[normalizedId]) {
    return MODEL_PRICING[normalizedId];
  }

  // Partial match
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalizedId.includes(key) || key.includes(normalizedId)) {
      return pricing;
    }
  }

  // Provider-based defaults
  if (normalizedId.includes("claude")) {
    return MODEL_PRICING["claude-3-5-sonnet"];
  }
  if (normalizedId.includes("gpt-4o")) {
    return MODEL_PRICING["gpt-4o"];
  }
  if (normalizedId.includes("gpt-4")) {
    return MODEL_PRICING["gpt-4-turbo"];
  }
  if (normalizedId.includes("gpt-3")) {
    return MODEL_PRICING["gpt-3.5-turbo"];
  }
  if (normalizedId.includes("gemini")) {
    return MODEL_PRICING["gemini-1.5-flash"];
  }

  return MODEL_PRICING["default"];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  cachedCost: number;
  totalCost: number;
  isEstimate: boolean; // True if using default pricing
}

/**
 * Estimate cost for a given model and token usage
 */
export function estimateCost(modelId: string, usage: TokenUsage): CostEstimate {
  const pricing = findModelPricing(modelId);
  const isEstimate = !MODEL_PRICING[modelId.toLowerCase()];

  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cachedTokens = usage.cachedInputTokens || 0;

  // Cached tokens are typically charged at a lower rate (or free)
  // We'll use 10% of input price as a conservative estimate
  const cachedRate = pricing.cachedPer1M ?? pricing.inputPer1M * 0.1;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  const cachedCost = (cachedTokens / 1_000_000) * cachedRate;

  return {
    inputCost,
    outputCost,
    cachedCost,
    totalCost: inputCost + outputCost + cachedCost,
    isEstimate,
  };
}

/**
 * Format cost as a display string
 */
export function formatCost(cost: number): string {
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format cost estimate with context
 */
export function formatCostEstimate(estimate: CostEstimate): string {
  const formatted = formatCost(estimate.totalCost);
  return estimate.isEstimate ? `~${formatted}` : formatted;
}
