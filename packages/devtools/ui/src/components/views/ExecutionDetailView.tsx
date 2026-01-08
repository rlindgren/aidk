/**
 * ExecutionDetailView - Main component that routes to type-specific views
 *
 * Determines which view to show based on execution characteristics:
 * - Tick timeline for executions with ticks (streaming)
 * - Model view for model:* executions
 * - Tool view for tool:* executions
 * - Fork view for engine:execute fork/spawn
 * - Default view for fallback
 */

import type { ExecutionViewProps } from "../types";
import { detectExecutionViewType } from "../types";
import { ModelExecutionView } from "./ModelExecutionView";
import { ToolExecutionView } from "./ToolExecutionView";
import { ForkExecutionView } from "./ForkExecutionView";
import { DefaultExecutionView } from "./DefaultExecutionView";

// Re-export for convenience
export { detectExecutionViewType };

/**
 * Renders the appropriate detail view for an execution without ticks.
 * Executions with ticks should use TickTimelineView instead.
 */
export function ExecutionDetailView(props: ExecutionViewProps) {
  const viewType = detectExecutionViewType(props.execution);

  // Note: tick view is handled separately in App.tsx for now
  // since it has many dependencies on parent state (expanded ticks, etc.)
  if (viewType === "ticks") {
    // This shouldn't happen as we only render this for non-tick executions
    return null;
  }

  switch (viewType) {
    case "model":
      return <ModelExecutionView {...props} />;
    case "tool":
      return <ToolExecutionView {...props} />;
    case "fork":
      return <ForkExecutionView {...props} />;
    case "default":
    default:
      return <DefaultExecutionView {...props} />;
  }
}

export default ExecutionDetailView;
