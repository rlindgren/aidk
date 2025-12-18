import { type KernelContext } from './context';

/**
 * Helper functions for working with metrics.
 * Supports both flat and nested metric structures via dot notation.
 */

/**
 * Add a metric value (accumulates).
 * Supports dot notation for nested paths: 'usage.input_tokens'
 */
export function addMetric(ctx: KernelContext, key: string, value: number): void {
  if (!ctx.metrics) {
    ctx.metrics = {};
  }
  ctx.metrics[key] = (ctx.metrics[key] || 0) + value;
}

/**
 * Set a metric value (overwrites).
 * Supports dot notation for nested paths: 'usage.input_tokens'
 */
export function setMetric(ctx: KernelContext, key: string, value: number): void {
  if (!ctx.metrics) {
    ctx.metrics = {};
  }
  ctx.metrics[key] = value;
}

/**
 * Get a metric value.
 * Supports dot notation for nested paths: 'usage.input_tokens'
 */
export function getMetric(ctx: KernelContext, key: string): number {
  return ctx.metrics?.[key] || 0;
}

/**
 * Add usage metrics from a usage object.
 * Converts nested structure to flat dot-notation keys.
 * 
 * @example
 * addUsageMetrics(ctx, { input_tokens: 100, output_tokens: 50 });
 * // Sets: ctx.metrics['usage.input_tokens'] = 100
 * //       ctx.metrics['usage.output_tokens'] = 50
 */
export function addUsageMetrics(ctx: KernelContext, usage: Record<string, number>): void {
  if (!ctx.metrics) {
    ctx.metrics = {};
  }
  
  for (const [key, value] of Object.entries(usage)) {
    const metricKey = `usage.${key}`;
    ctx.metrics[metricKey] = (ctx.metrics[metricKey] || 0) + value;
  }
}

/**
 * Get usage metrics as an object.
 * Converts flat dot-notation keys back to nested structure.
 * 
 * @example
 * const usage = getUsageMetrics(ctx);
 * // Returns: { input_tokens: 100, output_tokens: 50 }
 */
export function getUsageMetrics(ctx: KernelContext): Record<string, number> {
  if (!ctx.metrics) {
    return {};
  }
  
  const usage: Record<string, number> = {};
  for (const [key, value] of Object.entries(ctx.metrics)) {
    if (key.startsWith('usage.')) {
      const usageKey = key.substring(6); // Remove 'usage.' prefix
      usage[usageKey] = value;
    }
  }
  
  return usage;
}

