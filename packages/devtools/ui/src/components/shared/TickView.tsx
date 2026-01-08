/**
 * TickView - Reusable component for displaying tick data
 *
 * Used by:
 * - App.tsx for displaying ticks in root executions
 * - ModelExecutionView for displaying model execution as a tick
 */

import { useState } from "react";
import type { Tick, TickEvent, Execution, Procedure } from "../../hooks/useDevToolsEvents";
import { getExecutionDisplayInfo } from "../types";
import {
  SectionGroup,
  StatsGrid,
  UsageDisplay,
  SystemPromptView,
  ToolsView,
  MessagesView,
  ModelRequestView,
  ModelResponseView,
} from "./TickComponents";
import { ProceduresSection } from "./ProceduresSection";

// ============================================================================
// Types
// ============================================================================

interface Tool {
  name: string;
  description?: string;
  input?: unknown;
}

interface TimelineEntry {
  kind?: string;
  role?: string;
  content?: unknown;
  message?: { role: string; content: unknown };
}

// ============================================================================
// TickView - Main component
// ============================================================================

export interface TickViewProps {
  tick: Tick;
  isExpanded: boolean;
  onToggle: () => void;
  formatDuration: (start: number, end?: number) => string;
  procedures?: Procedure[];
  proceduresMap: Map<string, Procedure>;
  onSelectProcedure: (id: string) => void;
  // Optional child executions
  childExecutions?: Execution[];
  allExecutions?: Execution[];
  onSelectExecution?: (id: string) => void;
  // For model execution view - hide certain elements
  hideHeader?: boolean;
}

export function TickView({
  tick,
  isExpanded,
  onToggle,
  formatDuration,
  procedures = [],
  proceduresMap,
  onSelectProcedure,
  childExecutions = [],
  allExecutions = [],
  onSelectExecution,
  hideHeader = false,
}: TickViewProps) {
  const formatStopReason = (reason: unknown): string => {
    if (!reason) return "";
    if (typeof reason === "string") return reason;
    if (typeof reason === "object" && reason !== null && "reason" in reason) {
      return (reason as { reason: string }).reason;
    }
    return JSON.stringify(reason);
  };

  return (
    <div className="tick">
      {!hideHeader && (
        <div className="tick-header" onClick={onToggle}>
          <div>
            <span className="tick-number">Tick {tick.number}</span>
            {tick.model && <span className="tick-model"> · {tick.model}</span>}
            {tick.stopReason ? (
              <span className="tick-stop-reason">
                {" "}
                · {formatStopReason(tick.stopReason as string)}
              </span>
            ) : null}
          </div>
          <div className="tick-meta">
            <span>{formatDuration(tick.startTime, tick.endTime)}</span>
            <span> · </span>
            <UsageDisplay usage={tick.usage} compact />
            <span className="expand-icon">{isExpanded ? "−" : "+"}</span>
          </div>
        </div>
      )}
      {(isExpanded || hideHeader) && (
        <div className="tick-content">
          {/* Stats Grid */}
          <StatsGrid
            usage={tick.usage}
            toolCallCount={tick.events.filter((e) => e.type === "tool_call").length}
            messageCount={tick.compiled?.messages?.length ?? 0}
            eventCount={tick.events.filter((e) => e.type !== "content_delta").length}
          />

          {/* CONTEXT: What the model receives */}
          {tick.compiled && (
            <SectionGroup label="Context">
              {tick.compiled.system && <SystemPromptView system={tick.compiled.system} />}
              <ToolsView tools={(tick.compiled.tools ?? []) as Tool[]} />
              <MessagesView messages={(tick.compiled.messages ?? []) as TimelineEntry[]} />
            </SectionGroup>
          )}

          {/* MODEL: Request and Response */}
          {(tick.modelRequest || tick.providerRequest || tick.modelOutput) && (
            <SectionGroup label="Model">
              {(tick.modelRequest || tick.providerRequest) && (
                <ModelRequestView
                  modelRequest={tick.modelRequest}
                  providerRequest={tick.providerRequest}
                />
              )}
              {!!tick.modelOutput && (
                <ModelResponseView output={tick.modelOutput} raw={tick.modelOutputRaw} />
              )}
            </SectionGroup>
          )}

          {/* CHILD EXECUTIONS: Tool/fork/spawn executions that happened in this tick */}
          {childExecutions.length > 0 && (
            <div className="child-executions-section">
              <div className="child-executions-label">Child Executions</div>
              {childExecutions.map((childExec) => (
                <ChildExecutionCard
                  key={childExec.id}
                  execution={childExec}
                  allExecutions={allExecutions}
                  onClick={() => onSelectExecution?.(childExec.id)}
                  formatDuration={formatDuration}
                  proceduresMap={proceduresMap}
                />
              ))}
            </div>
          )}

          {/* OUTPUT: What the model produced */}
          {(tick.modelOutput || tick.content) && (
            <SectionGroup label="Output">
              {!!tick.modelOutput && <OutputBlocksView output={tick.modelOutput} />}
              {tick.content && <StreamedOutputView content={tick.content} />}
            </SectionGroup>
          )}

          {/* Events (standalone) */}
          <EventsView events={tick.events} />

          {/* Procedures (standalone) */}
          {procedures.length > 0 && (
            <ProceduresSection
              procedures={procedures}
              proceduresMap={proceduresMap}
              onSelectProcedure={onSelectProcedure}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Child Execution Card
// ============================================================================

interface ChildExecutionCardProps {
  execution: Execution;
  allExecutions: Execution[];
  onClick: () => void;
  formatDuration: (start: number, end?: number) => string;
  proceduresMap: Map<string, Procedure>;
}

function ChildExecutionCard({
  execution,
  allExecutions,
  onClick,
  formatDuration,
  proceduresMap,
}: ChildExecutionCardProps) {
  const childCount = allExecutions.filter((e) => e.parentExecutionId === execution.id).length;

  const getAggregateTokens = (exec: Execution): number => {
    const ownTokens =
      exec.totalUsage?.totalTokens ??
      exec.ticks.reduce((sum, t) => sum + (t.usage?.totalTokens ?? 0), 0);
    const children = allExecutions.filter((e) => e.parentExecutionId === exec.id);
    return ownTokens + children.reduce((sum, child) => sum + getAggregateTokens(child), 0);
  };

  const tokens = getAggregateTokens(execution);
  const displayInfo = getExecutionDisplayInfo(execution, proceduresMap);

  return (
    <div className="child-execution-card" onClick={onClick}>
      <div className="child-execution-header">
        <span className="child-execution-name">{displayInfo.name}</span>
        {displayInfo.badge && (
          <span className={`exec-type-badge small ${displayInfo.badgeClass || displayInfo.badge}`}>
            {displayInfo.badge}
          </span>
        )}
        <span className="child-execution-stats">
          {tokens > 0 && <span>{tokens} tok</span>}
          <span> · </span>
          <span>{formatDuration(execution.startTime, execution.endTime)}</span>
        </span>
      </div>
      {childCount > 0 && (
        <div className="child-execution-summary">
          {childCount} child execution{childCount > 1 ? "s" : ""}
        </div>
      )}
      <div className="child-execution-action">Click to view →</div>
    </div>
  );
}

// ============================================================================
// Output Blocks View
// ============================================================================

interface OutputBlocksViewProps {
  output: unknown;
}

function OutputBlocksView({ output }: OutputBlocksViewProps) {
  const [expanded, setExpanded] = useState(false);

  const message = output as { role?: string; content?: unknown[] } | null;
  if (!message) return null;

  const content = Array.isArray(message.content) ? message.content : [];
  if (content.length === 0) return null;

  const renderContentBlock = (block: Record<string, unknown>, index: number): React.ReactNode => {
    switch (block.type) {
      case "text":
        return (
          <div key={index} className="output-block text-block">
            <span className="block-type">text</span>
            <div className="block-content">{block.text as string}</div>
          </div>
        );
      case "reasoning":
        return (
          <div key={index} className="output-block reasoning-block">
            <span className="block-type">reasoning</span>
            <div className="block-content reasoning">{block.text as string}</div>
          </div>
        );
      case "tool-call":
      case "tool_use":
        return (
          <div key={index} className="output-block tool-call-block">
            <span className="block-type">tool_call</span>
            <div className="block-content">
              <span className="tool-name">{(block.toolName || block.name) as string}</span>
              <pre className="code-block small">{JSON.stringify(block.input, null, 2)}</pre>
            </div>
          </div>
        );
      default:
        return (
          <div key={index} className="output-block unknown-block">
            <span className="block-type">{block.type as string}</span>
            <pre className="code-block small">{JSON.stringify(block, null, 2)}</pre>
          </div>
        );
    }
  };

  return (
    <div className="section section--output">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Blocks ({content.length})
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          <div className="output-blocks">
            {content.map((block, i) => renderContentBlock(block as Record<string, unknown>, i))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Events View
// ============================================================================

interface EventsViewProps {
  events: TickEvent[];
}

function EventsView({ events }: EventsViewProps) {
  const [expanded, setExpanded] = useState(false);

  const visibleEvents = events.filter((e) => e.type !== "content_delta");

  if (visibleEvents.length === 0) {
    return (
      <div className="section section--events empty">
        <div className="section-header">
          <span className="section-title">Events (0)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="section section--events">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Events ({visibleEvents.length})
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          {visibleEvents.map((event, i) => (
            <EventView key={i} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Event View
// ============================================================================

interface EventViewProps {
  event: TickEvent;
}

function EventView({ event }: EventViewProps) {
  const [expanded, setExpanded] = useState(false);
  const data = event.data as Record<string, unknown>;

  const getSummary = (): string => {
    switch (event.type) {
      case "tool_call":
        return data.name as string;
      case "tool_result":
        return data.isError ? "Error" : "Success";
      case "model_start":
        return `${data.provider}/${data.modelId}`;
      case "state_change":
        return data.key as string;
      case "model_request":
      case "provider_request":
        return "Request data";
      case "provider_response":
      case "model_response":
        return "Response data";
      default:
        return "";
    }
  };

  const renderEventData = () => {
    switch (event.type) {
      case "tool_call":
        return (
          <div className="event-data">
            <div className="tool-name">{data.name as string}</div>
            <pre className="code-block">{JSON.stringify(data.input, null, 2)}</pre>
          </div>
        );
      case "tool_result":
        return (
          <div className={`event-data ${data.isError ? "error" : ""}`}>
            <pre className="code-block">{JSON.stringify(data.result, null, 2)}</pre>
          </div>
        );
      case "content_delta":
        return null;
      case "model_start":
        return (
          <div className="event-data">
            {String(data.provider)}/{String(data.modelId)}
          </div>
        );
      case "state_change":
        return (
          <div className="event-data">
            <span className="state-key">{data.key as string}</span>:{" "}
            <span className="state-old">{JSON.stringify(data.oldValue)}</span>
            {" → "}
            <span className="state-new">{JSON.stringify(data.newValue)}</span>
          </div>
        );
      default:
        return (
          <div className="event-data">
            <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>
          </div>
        );
    }
  };

  if (event.type === "content_delta") return null;

  const summary = getSummary();

  return (
    <div className={`event ${event.type} ${expanded ? "expanded" : "collapsed"}`}>
      <div className="event-header" onClick={() => setExpanded(!expanded)}>
        <span className="expand-icon small">{expanded ? "▼" : "▶"}</span>
        <span className="event-type">{event.type}</span>
        {!expanded && summary && <span className="event-summary">{summary}</span>}
        <span className="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
      </div>
      {expanded && renderEventData()}
    </div>
  );
}

// ============================================================================
// Streamed Output View
// ============================================================================

interface StreamedOutputViewProps {
  content: string;
}

function StreamedOutputView({ content }: StreamedOutputViewProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="section section--output">
      <div className="section-header" onClick={() => setExpanded(!expanded)}>
        <span className="section-title">
          <span className="expand-icon">{expanded ? "▼" : "▶"}</span>
          Streamed Text
        </span>
      </div>
      {expanded && (
        <div className="section-content">
          <div className="output-content">{content}</div>
        </div>
      )}
    </div>
  );
}

export default TickView;
