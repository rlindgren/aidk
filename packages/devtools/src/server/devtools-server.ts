/**
 * DevTools Server
 *
 * A standalone HTTP server that:
 * 1. Serves the devtools UI
 * 2. Provides an SSE endpoint for real-time events
 * 3. Receives events from engine instances and broadcasts to connected clients
 */
import { createServer, type Server } from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import type { DevToolsEvent } from "../events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DevToolsServerConfig {
  /** Port to listen on (default: 3001) */
  port?: number;
  /** Host to bind to (default: '127.0.0.1' - localhost only for security) */
  host?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Secret token for POST /events authentication (optional but recommended for non-localhost) */
  secret?: string;
  /** Allowed origins for CORS (default: localhost only) */
  allowedOrigins?: string[];
  /** Max requests per minute per IP for POST /events (default: 1000) */
  rateLimit?: number;
}

interface SSEClient {
  res: ServerResponse;
  heartbeatInterval: NodeJS.Timeout;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface ProcedureInfo {
  name: string;
  type?: string;
  parentId?: string;
  executionId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "running" | "completed" | "error";
  error?: string;
  metadata?: Record<string, unknown>;
}

interface ProcedureTreeNode {
  id: string;
  name: string;
  type?: string;
  status: "running" | "completed" | "error";
  startTime?: number;
  endTime?: number;
  durationMs?: number;
  error?: string;
  children?: ProcedureTreeNode[];
}

// Required config with defaults applied
interface ResolvedConfig {
  port: number;
  host: string;
  debug: boolean;
  heartbeatInterval: number;
  secret?: string;
  allowedOrigins: string[];
  rateLimit: number;
}

export class DevToolsServer {
  private server: Server | null = null;
  private clients = new Set<SSEClient>();
  private config: ResolvedConfig;
  private eventHistory: DevToolsEvent[] = [];
  private maxHistorySize = 1000;
  private rateLimitMap = new Map<string, RateLimitEntry>();

  constructor(config: DevToolsServerConfig = {}) {
    this.config = {
      port: config.port ?? 3001,
      host: config.host ?? "127.0.0.1", // Localhost only by default for security
      debug: config.debug ?? false,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      secret: config.secret,
      allowedOrigins: config.allowedOrigins ?? ["http://localhost:*", "http://127.0.0.1:*"],
      rateLimit: config.rateLimit ?? 1000, // 1000 requests per minute per IP
    };
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log("🔧 [DevTools]", ...args);
    }
  }

  /**
   * Start the devtools server
   */
  start(): void {
    if (this.server) {
      this.log("Server already running");
      return;
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));

    // Security warning for non-localhost binding
    if (this.config.host !== "127.0.0.1" && this.config.host !== "localhost") {
      console.warn(
        "⚠️  [DevTools] WARNING: Server binding to non-localhost address.",
        this.config.secret
          ? "Secret token authentication is enabled."
          : "Consider setting a secret token for security!",
      );
    }

    this.server.listen(this.config.port, this.config.host, () => {
      this.log(`Server listening on ${this.config.host}:${this.config.port}`);
    });
  }

  /**
   * Stop the devtools server and clean up
   */
  stop(): void {
    // Close all SSE connections
    for (const client of this.clients) {
      clearInterval(client.heartbeatInterval);
      client.res.end();
    }
    this.clients.clear();

    // Close the server
    this.server?.close();
    this.server = null;
    this.log("Server stopped");
  }

  /**
   * Emit an event to all connected clients
   */
  emit(event: DevToolsEvent): void {
    // Store in history for new clients
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Broadcast to all connected clients
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(data);
      } catch {
        // Client disconnected, will be cleaned up by close handler
      }
    }

    this.log(`Emitted ${event.type} to ${this.clients.size} clients`);
  }

  /**
   * Get the URL for the devtools UI
   */
  getUrl(): string {
    return `http://localhost:${this.config.port}`;
  }

  /**
   * Get client IP address from request
   */
  private getClientIp(req: IncomingMessage): string {
    // Support proxied requests
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "unknown";
  }

  /**
   * Check if origin is allowed for CORS
   */
  private isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true; // Same-origin requests don't have Origin header

    for (const pattern of this.config.allowedOrigins) {
      if (pattern === "*") return true;
      if (pattern.includes("*")) {
        // Simple wildcard matching (e.g., "http://localhost:*")
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        if (regex.test(origin)) return true;
      } else if (origin === pattern) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check rate limit for IP
   */
  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);

    if (!entry || now > entry.resetTime) {
      // New window
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + 60000 }); // 1 minute window
      return true;
    }

    if (entry.count >= this.config.rateLimit) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Verify authorization token
   */
  private verifyAuth(req: IncomingMessage): boolean {
    if (!this.config.secret) return true; // No secret configured

    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    const [type, token] = authHeader.split(" ");
    return type === "Bearer" && token === this.config.secret;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", `http://${this.config.host}:${this.config.port}`);
    const origin = req.headers.origin as string | undefined;

    // CORS handling - only allow configured origins
    if (this.isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    } else {
      this.log(`Blocked request from origin: ${origin}`);
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route handling
    if (url.pathname === "/events" && req.method === "POST") {
      this.handlePostEvent(req, res);
    } else if (url.pathname === "/events") {
      this.handleSSE(req, res);
    } else if (url.pathname.startsWith("/api/")) {
      // All API endpoints require auth when secret is configured
      if (!this.verifyAuth(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      this.handleApiRoute(url, res);
    } else {
      this.handleStatic(url.pathname, res);
    }
  }

  private handleApiRoute(url: URL, res: ServerResponse): void {
    if (url.pathname === "/api/history") {
      this.handleHistory(res);
    } else if (url.pathname === "/api/events") {
      this.handleApiEvents(url, res);
    } else if (url.pathname === "/api/summary") {
      this.handleApiSummary(res);
    } else if (url.pathname === "/api/executions") {
      this.handleApiExecutions(url, res);
    } else if (url.pathname.startsWith("/api/executions/") && url.pathname.endsWith("/tree")) {
      const id = url.pathname.slice("/api/executions/".length, -"/tree".length);
      this.handleApiExecutionTree(url, id, res);
    } else if (url.pathname.startsWith("/api/procedures/") && url.pathname.endsWith("/tree")) {
      const id = url.pathname.slice("/api/procedures/".length, -"/tree".length);
      this.handleApiProcedureTree(url, id, res);
    } else if (url.pathname === "/api/errors") {
      this.handleApiErrors(url, res);
    } else if (url.pathname === "/api/tools") {
      this.handleApiTools(url, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  private handleSSE(_req: IncomingMessage, res: ServerResponse): void {
    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

    // Setup heartbeat
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(":heartbeat\n\n");
      } catch {
        // Connection closed
      }
    }, this.config.heartbeatInterval);

    const client: SSEClient = { res, heartbeatInterval };
    this.clients.add(client);

    this.log(`Client connected, total: ${this.clients.size}`);

    // Cleanup on close
    res.on("close", () => {
      clearInterval(heartbeatInterval);
      this.clients.delete(client);
      this.log(`Client disconnected, total: ${this.clients.size}`);
    });
  }

  private handleHistory(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.eventHistory));
  }

  /**
   * GET /api/events - Query events with filtering and pagination
   *
   * Query params:
   * - type: Filter by event type (e.g., "tool_call", "procedure_start")
   * - executionId: Filter by execution ID
   * - procedureId: Filter by procedure ID
   * - sessionId: Filter by session ID
   * - limit: Max events to return (default: 100, max: 1000)
   * - offset: Skip first N events (for pagination)
   * - order: "asc" or "desc" by timestamp (default: "desc")
   */
  private handleApiEvents(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const typeFilter = params.get("type");
    const executionIdFilter = params.get("executionId");
    const procedureIdFilter = params.get("procedureId");
    const sessionIdFilter = params.get("sessionId");
    const limit = Math.min(parseInt(params.get("limit") || "100", 10), 1000);
    const offset = parseInt(params.get("offset") || "0", 10);
    const order = params.get("order") || "desc";

    let events = [...this.eventHistory];

    // Apply filters
    if (typeFilter) {
      events = events.filter((e) => e.type === typeFilter);
    }
    if (executionIdFilter) {
      events = events.filter((e) => e.executionId === executionIdFilter);
    }
    if (procedureIdFilter) {
      events = events.filter((e) => {
        const proc = e as { procedureId?: string };
        return proc.procedureId === procedureIdFilter;
      });
    }
    if (sessionIdFilter) {
      events = events.filter((e) => {
        const exec = e as { sessionId?: string };
        return exec.sessionId === sessionIdFilter;
      });
    }

    // Sort
    events.sort((a, b) =>
      order === "asc" ? a.timestamp - b.timestamp : b.timestamp - a.timestamp,
    );

    // Paginate
    const total = events.length;
    events = events.slice(offset, offset + limit);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        events,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + events.length < total,
        },
      }),
    );
  }

  /**
   * GET /api/summary - Get a markdown summary of current state for LLM consumption
   *
   * Returns a structured markdown document with:
   * - Active executions
   * - Recent procedures with status
   * - Error summary
   * - Token usage summary
   */
  private handleApiSummary(res: ServerResponse): void {
    const summary = this.generateMarkdownSummary();
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(summary);
  }

  /**
   * Generate a markdown summary of the current DevTools state
   */
  private generateMarkdownSummary(): string {
    const lines: string[] = [];
    lines.push("# AIDK DevTools Summary");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Total events in history: ${this.eventHistory.length}`);
    lines.push("");

    // Group events by execution
    const executionMap = new Map<
      string,
      {
        agentName?: string;
        sessionId?: string;
        startTime?: number;
        endTime?: number;
        status: "running" | "completed" | "error";
        ticks: number;
        totalTokens: number;
        errors: string[];
        toolCalls: { name: string; status: string }[];
      }
    >();

    // Group procedures
    const procedureMap = new Map<
      string,
      {
        name: string;
        status: string;
        startTime: number;
        endTime?: number;
        error?: string;
      }
    >();

    for (const event of this.eventHistory) {
      // Track executions
      if (!executionMap.has(event.executionId)) {
        executionMap.set(event.executionId, {
          status: "running",
          ticks: 0,
          totalTokens: 0,
          errors: [],
          toolCalls: [],
        });
      }
      const exec = executionMap.get(event.executionId)!;

      if (event.type === "execution_start") {
        const e = event as { agentName?: string; sessionId?: string };
        exec.agentName = e.agentName;
        exec.sessionId = e.sessionId;
        exec.startTime = event.timestamp;
      } else if (event.type === "execution_end") {
        exec.endTime = event.timestamp;
        exec.status = "completed";
      } else if (event.type === "tick_end") {
        exec.ticks++;
        const e = event as { usage?: { totalTokens?: number } };
        if (e.usage?.totalTokens) {
          exec.totalTokens += e.usage.totalTokens;
        }
      } else if (event.type === "tool_call") {
        const e = event as { toolName?: string };
        exec.toolCalls.push({ name: e.toolName || "unknown", status: "pending" });
      } else if (event.type === "tool_result") {
        const e = event as { isError?: boolean };
        const lastCall = exec.toolCalls[exec.toolCalls.length - 1];
        if (lastCall) {
          lastCall.status = e.isError ? "error" : "success";
        }
      }

      // Track procedures
      if (event.type === "procedure_start") {
        const e = event as { procedureId?: string; procedureName?: string };
        if (e.procedureId) {
          procedureMap.set(e.procedureId, {
            name: e.procedureName || "unknown",
            status: "running",
            startTime: event.timestamp,
          });
        }
      } else if (event.type === "procedure_end") {
        const e = event as { procedureId?: string };
        if (e.procedureId && procedureMap.has(e.procedureId)) {
          const proc = procedureMap.get(e.procedureId)!;
          proc.status = "completed";
          proc.endTime = event.timestamp;
        }
      } else if (event.type === "procedure_error") {
        const e = event as { procedureId?: string; error?: { message?: string } };
        if (e.procedureId && procedureMap.has(e.procedureId)) {
          const proc = procedureMap.get(e.procedureId)!;
          proc.status = "error";
          proc.error = e.error?.message || "Unknown error";
          proc.endTime = event.timestamp;
        }
      }
    }

    // Executions section
    lines.push("## Executions");
    lines.push("");
    if (executionMap.size === 0) {
      lines.push("No executions recorded.");
    } else {
      lines.push("| ID | Agent | Status | Ticks | Tokens | Tools |");
      lines.push("|---|---|---|---|---|---|");
      for (const [id, exec] of executionMap) {
        const toolSummary =
          exec.toolCalls.length > 0
            ? `${exec.toolCalls.filter((t) => t.status === "success").length}/${exec.toolCalls.length} ok`
            : "-";
        lines.push(
          `| ${id.slice(0, 8)}... | ${exec.agentName || "-"} | ${exec.status} | ${exec.ticks} | ${exec.totalTokens} | ${toolSummary} |`,
        );
      }
    }
    lines.push("");

    // Procedures section
    const recentProcedures = Array.from(procedureMap.entries())
      .sort((a, b) => b[1].startTime - a[1].startTime)
      .slice(0, 20);

    lines.push("## Recent Procedures (last 20)");
    lines.push("");
    if (recentProcedures.length === 0) {
      lines.push("No procedures recorded.");
    } else {
      lines.push("| ID | Name | Status | Duration |");
      lines.push("|---|---|---|---|");
      for (const [id, proc] of recentProcedures) {
        const duration = proc.endTime ? `${proc.endTime - proc.startTime}ms` : "running...";
        const status = proc.error ? `error: ${proc.error.slice(0, 30)}` : proc.status;
        lines.push(`| ${id.slice(0, 8)}... | ${proc.name} | ${status} | ${duration} |`);
      }
    }
    lines.push("");

    // Errors section
    const errors = this.eventHistory.filter(
      (e) => e.type === "procedure_error" || (e as { isError?: boolean }).isError,
    );
    if (errors.length > 0) {
      lines.push("## Errors");
      lines.push("");
      for (const err of errors.slice(-10)) {
        const e = err as { error?: { message?: string }; procedureId?: string };
        lines.push(
          `- [${new Date(err.timestamp).toISOString()}] ${e.procedureId?.slice(0, 8) || err.executionId.slice(0, 8)}: ${e.error?.message || "Unknown error"}`,
        );
      }
      lines.push("");
    }

    // API help
    lines.push("## API Endpoints");
    lines.push("");
    lines.push("**Structured queries (recommended):**");
    lines.push("```");
    lines.push("GET /api/summary                    # This markdown summary");
    lines.push("GET /api/executions                 # List all executions");
    lines.push("GET /api/executions/{id}/tree       # Execution with procedure tree");
    lines.push("GET /api/procedures/{id}/tree       # Procedure subtree + ancestry");
    lines.push("GET /api/errors                     # All errors with context");
    lines.push("GET /api/tools                      # Tool calls paired with results");
    lines.push("```");
    lines.push("");
    lines.push("**Raw event filtering:**");
    lines.push("```");
    lines.push("GET /api/events?type=tool_call&limit=50");
    lines.push("GET /api/events?executionId={id}&order=asc");
    lines.push("```");
    lines.push("");

    return lines.join("\n");
  }

  // ============================================================================
  // Structured API Endpoints
  // ============================================================================

  /**
   * GET /api/executions - List all executions with summary info
   *
   * Query params:
   * - status: Filter by status (running, completed, error)
   * - sessionId: Filter by session ID
   * - agentName: Filter by agent name (substring match)
   * - executionType: Filter by execution type (engine, model, tool, fork, spawn, etc.)
   */
  private handleApiExecutions(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const statusFilter = params.get("status") as "running" | "completed" | "error" | null;
    const sessionIdFilter = params.get("sessionId");
    const agentNameFilter = params.get("agentName");
    const executionTypeFilter = params.get("executionType");
    const limit = Math.min(parseInt(params.get("limit") || "100", 10), 1000);
    const offset = parseInt(params.get("offset") || "0", 10);

    let executions = this.buildExecutionSummaries();

    // Apply filters
    if (statusFilter) {
      executions = executions.filter((e) => e.status === statusFilter);
    }
    if (sessionIdFilter) {
      executions = executions.filter((e) => e.sessionId === sessionIdFilter);
    }
    if (agentNameFilter) {
      executions = executions.filter((e) =>
        e.agentName?.toLowerCase().includes(agentNameFilter.toLowerCase()),
      );
    }
    if (executionTypeFilter) {
      executions = executions.filter((e) => e.executionType === executionTypeFilter);
    }

    // Paginate
    const total = executions.length;
    executions = executions.slice(offset, offset + limit);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        executions,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + executions.length < total,
        },
      }),
    );
  }

  /**
   * GET /api/executions/{id}/tree - Get execution with full procedure tree
   *
   * Query params:
   * - procedureStatus: Filter procedures by status (running, completed, error)
   * - procedureType: Filter procedures by type (model, tool, component, etc.)
   * - procedureName: Filter procedures by name (substring match)
   */
  private handleApiExecutionTree(url: URL, executionId: string, res: ServerResponse): void {
    const params = url.searchParams;
    const procedureStatusFilter = params.get("procedureStatus") as
      | "running"
      | "completed"
      | "error"
      | null;
    const procedureTypeFilter = params.get("procedureType");
    const procedureNameFilter = params.get("procedureName");

    const executions = this.buildExecutionSummaries();
    const execution = executions.find((e) => e.id === executionId || e.id.startsWith(executionId));

    if (!execution) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Execution not found" }));
      return;
    }

    // Get all procedures for this execution
    const procedures = this.buildProcedureMap();
    const executionProcedures = new Map<string, ProcedureInfo>();

    for (const [id, proc] of procedures) {
      if (proc.executionId === execution.id) {
        // Apply procedure filters
        if (procedureStatusFilter && proc.status !== procedureStatusFilter) continue;
        if (procedureTypeFilter && proc.type !== procedureTypeFilter) continue;
        if (
          procedureNameFilter &&
          !proc.name.toLowerCase().includes(procedureNameFilter.toLowerCase())
        )
          continue;
        executionProcedures.set(id, proc);
      }
    }

    // Build tree from root procedures (no parent in filtered set)
    const tree = this.buildProcedureTree(executionProcedures);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        execution,
        procedureTree: tree,
        procedureCount: executionProcedures.size,
        filters: {
          procedureStatus: procedureStatusFilter,
          procedureType: procedureTypeFilter,
          procedureName: procedureNameFilter,
        },
      }),
    );
  }

  /**
   * GET /api/procedures/{id}/tree - Get procedure and all its descendants
   *
   * Query params:
   * - status: Filter descendants by status (running, completed, error)
   * - type: Filter descendants by type (model, tool, component, etc.)
   * - name: Filter descendants by name (substring match)
   * - maxDepth: Maximum depth of tree to return (default: unlimited)
   */
  private handleApiProcedureTree(url: URL, procedureId: string, res: ServerResponse): void {
    const params = url.searchParams;
    const statusFilter = params.get("status") as "running" | "completed" | "error" | null;
    const typeFilter = params.get("type");
    const nameFilter = params.get("name");
    const maxDepth = params.get("maxDepth") ? parseInt(params.get("maxDepth")!, 10) : undefined;

    const procedures = this.buildProcedureMap();

    // Find the procedure (support prefix matching)
    let rootProc: ProcedureInfo | undefined;
    let rootId: string | undefined;
    for (const [id, proc] of procedures) {
      if (id === procedureId || id.startsWith(procedureId)) {
        rootProc = proc;
        rootId = id;
        break;
      }
    }

    if (!rootProc || !rootId) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Procedure not found" }));
      return;
    }

    // Build subtree rooted at this procedure with filters
    const subtree = this.buildSubtree(rootId, procedures, {
      statusFilter,
      typeFilter,
      nameFilter,
      maxDepth,
    });

    // Get ancestry (path from root to this procedure)
    const ancestry = this.getAncestry(rootId, procedures);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        procedure: {
          id: rootId,
          ...rootProc,
        },
        ancestry,
        children: subtree,
        filters: {
          status: statusFilter,
          type: typeFilter,
          name: nameFilter,
          maxDepth,
        },
      }),
    );
  }

  /**
   * GET /api/errors - Get all errors with context
   *
   * Query params:
   * - executionId: Filter by execution
   * - procedureName: Filter by procedure name (substring match)
   * - limit/offset: Pagination
   */
  private handleApiErrors(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const executionIdFilter = params.get("executionId");
    const procedureNameFilter = params.get("procedureName");
    const limit = Math.min(parseInt(params.get("limit") || "100", 10), 1000);
    const offset = parseInt(params.get("offset") || "0", 10);

    const procedures = this.buildProcedureMap();
    let errors: Array<{
      timestamp: number;
      executionId: string;
      procedureId?: string;
      procedureName?: string;
      error: { name?: string; message: string; stack?: string };
      ancestry: string[];
    }> = [];

    for (const event of this.eventHistory) {
      if (event.type === "procedure_error") {
        // Apply execution filter
        if (executionIdFilter && event.executionId !== executionIdFilter) continue;

        const e = event as {
          procedureId?: string;
          procedureName?: string;
          error?: { name?: string; message?: string; stack?: string };
        };

        // Apply procedure name filter
        if (
          procedureNameFilter &&
          e.procedureName &&
          !e.procedureName.toLowerCase().includes(procedureNameFilter.toLowerCase())
        )
          continue;

        const ancestry = e.procedureId ? this.getAncestry(e.procedureId, procedures) : [];

        errors.push({
          timestamp: event.timestamp,
          executionId: event.executionId,
          procedureId: e.procedureId,
          procedureName: e.procedureName,
          error: {
            name: e.error?.name,
            message: e.error?.message || "Unknown error",
            stack: e.error?.stack,
          },
          ancestry,
        });
      }
    }

    // Sort newest first
    errors.sort((a, b) => b.timestamp - a.timestamp);

    // Paginate
    const total = errors.length;
    errors = errors.slice(offset, offset + limit);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        errors,
        count: total,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + errors.length < total,
        },
      }),
    );
  }

  /**
   * GET /api/tools - Get all tool calls with their results paired together
   *
   * Query params:
   * - executionId: Filter by execution
   * - toolName: Filter by tool name (substring match)
   * - status: Filter by status (succeeded, failed, pending)
   * - limit/offset: Pagination
   */
  private handleApiTools(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const executionIdFilter = params.get("executionId");
    const toolNameFilter = params.get("toolName");
    const statusFilter = params.get("status") as "succeeded" | "failed" | "pending" | null;
    const limit = Math.min(parseInt(params.get("limit") || "100", 10), 1000);
    const offset = parseInt(params.get("offset") || "0", 10);

    const toolCalls = new Map<
      string,
      {
        callId: string;
        executionId: string;
        tick: number;
        timestamp: number;
        toolName: string;
        input?: unknown;
        result?: {
          timestamp: number;
          output?: unknown;
          isError?: boolean;
        };
      }
    >();

    for (const event of this.eventHistory) {
      if (event.type === "tool_call") {
        const e = event as {
          tick: number;
          toolName?: string;
          callId?: string;
          input?: unknown;
        };
        if (e.callId) {
          // Apply execution filter
          if (executionIdFilter && event.executionId !== executionIdFilter) continue;
          // Apply tool name filter
          if (
            toolNameFilter &&
            e.toolName &&
            !e.toolName.toLowerCase().includes(toolNameFilter.toLowerCase())
          )
            continue;

          toolCalls.set(e.callId, {
            callId: e.callId,
            executionId: event.executionId,
            tick: e.tick,
            timestamp: event.timestamp,
            toolName: e.toolName || "unknown",
            input: e.input,
          });
        }
      } else if (event.type === "tool_result") {
        const e = event as {
          callId?: string;
          output?: unknown;
          isError?: boolean;
        };
        if (e.callId && toolCalls.has(e.callId)) {
          const call = toolCalls.get(e.callId)!;
          call.result = {
            timestamp: event.timestamp,
            output: e.output,
            isError: e.isError,
          };
        }
      }
    }

    let tools = Array.from(toolCalls.values());

    // Apply status filter
    if (statusFilter === "succeeded") {
      tools = tools.filter((t) => t.result && !t.result.isError);
    } else if (statusFilter === "failed") {
      tools = tools.filter((t) => t.result?.isError);
    } else if (statusFilter === "pending") {
      tools = tools.filter((t) => !t.result);
    }

    // Sort newest first
    tools.sort((a, b) => b.timestamp - a.timestamp);

    // Summary stats (before pagination)
    const summary = {
      total: tools.length,
      succeeded: tools.filter((t) => t.result && !t.result.isError).length,
      failed: tools.filter((t) => t.result?.isError).length,
      pending: tools.filter((t) => !t.result).length,
    };

    // Paginate
    const total = tools.length;
    tools = tools.slice(offset, offset + limit);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tools,
        summary,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + tools.length < total,
        },
      }),
    );
  }

  // ============================================================================
  // Helper Methods for Building Data Structures
  // ============================================================================

  private buildExecutionSummaries(): Array<{
    id: string;
    agentName?: string;
    sessionId?: string;
    executionType?: string;
    status: "running" | "completed" | "error";
    startTime?: number;
    endTime?: number;
    durationMs?: number;
    ticks: number;
    totalTokens: number;
    toolCalls: number;
    errors: number;
  }> {
    const executionMap = new Map<
      string,
      {
        id: string;
        agentName?: string;
        sessionId?: string;
        executionType?: string;
        status: "running" | "completed" | "error";
        startTime?: number;
        endTime?: number;
        ticks: number;
        totalTokens: number;
        toolCalls: number;
        errors: number;
      }
    >();

    for (const event of this.eventHistory) {
      if (!executionMap.has(event.executionId)) {
        executionMap.set(event.executionId, {
          id: event.executionId,
          status: "running",
          ticks: 0,
          totalTokens: 0,
          toolCalls: 0,
          errors: 0,
        });
      }
      const exec = executionMap.get(event.executionId)!;

      if (event.type === "execution_start") {
        const e = event as { agentName?: string; sessionId?: string; executionType?: string };
        exec.agentName = e.agentName;
        exec.sessionId = e.sessionId;
        exec.executionType = e.executionType;
        exec.startTime = event.timestamp;
      } else if (event.type === "execution_end") {
        exec.endTime = event.timestamp;
        exec.status = "completed";
      } else if (event.type === "tick_end") {
        exec.ticks++;
        const e = event as { usage?: { totalTokens?: number } };
        if (e.usage?.totalTokens) {
          exec.totalTokens += e.usage.totalTokens;
        }
      } else if (event.type === "tool_call") {
        exec.toolCalls++;
      } else if (event.type === "procedure_error") {
        exec.errors++;
        exec.status = "error";
      }
    }

    return Array.from(executionMap.values()).map((exec) => ({
      ...exec,
      durationMs: exec.startTime && exec.endTime ? exec.endTime - exec.startTime : undefined,
    }));
  }

  private buildProcedureMap(): Map<string, ProcedureInfo> {
    const procedures = new Map<string, ProcedureInfo>();

    for (const event of this.eventHistory) {
      if (event.type === "procedure_start") {
        const e = event as {
          procedureId?: string;
          procedureName?: string;
          procedureType?: string;
          parentProcedureId?: string;
          metadata?: Record<string, unknown>;
        };
        if (e.procedureId) {
          procedures.set(e.procedureId, {
            name: e.procedureName || "unknown",
            type: e.procedureType,
            parentId: e.parentProcedureId,
            executionId: event.executionId,
            startTime: event.timestamp,
            status: "running",
            metadata: e.metadata,
          });
        }
      } else if (event.type === "procedure_end") {
        const e = event as { procedureId?: string; durationMs?: number };
        if (e.procedureId && procedures.has(e.procedureId)) {
          const proc = procedures.get(e.procedureId)!;
          proc.status = "completed";
          proc.endTime = event.timestamp;
          proc.durationMs =
            e.durationMs || (proc.startTime ? event.timestamp - proc.startTime : undefined);
        }
      } else if (event.type === "procedure_error") {
        const e = event as { procedureId?: string; error?: { message?: string } };
        if (e.procedureId && procedures.has(e.procedureId)) {
          const proc = procedures.get(e.procedureId)!;
          proc.status = "error";
          proc.endTime = event.timestamp;
          proc.error = e.error?.message;
        }
      }
    }

    return procedures;
  }

  private buildProcedureTree(procedures: Map<string, ProcedureInfo>): ProcedureTreeNode[] {
    // Find root procedures (no parent or parent not in this set)
    const roots: string[] = [];
    for (const [id, proc] of procedures) {
      if (!proc.parentId || !procedures.has(proc.parentId)) {
        roots.push(id);
      }
    }

    // Build tree recursively
    const buildNode = (id: string): ProcedureTreeNode => {
      const proc = procedures.get(id)!;
      const children: ProcedureTreeNode[] = [];

      // Find children
      for (const [childId, childProc] of procedures) {
        if (childProc.parentId === id) {
          children.push(buildNode(childId));
        }
      }

      // Sort children by start time
      children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      return {
        id,
        name: proc.name,
        type: proc.type,
        status: proc.status,
        startTime: proc.startTime,
        endTime: proc.endTime,
        durationMs: proc.durationMs,
        error: proc.error,
        children: children.length > 0 ? children : undefined,
      };
    };

    // Sort roots by start time
    roots.sort((a, b) => {
      const aProc = procedures.get(a)!;
      const bProc = procedures.get(b)!;
      return (aProc.startTime || 0) - (bProc.startTime || 0);
    });

    return roots.map(buildNode);
  }

  private buildSubtree(
    rootId: string,
    procedures: Map<string, ProcedureInfo>,
    filters?: {
      statusFilter?: "running" | "completed" | "error" | null;
      typeFilter?: string | null;
      nameFilter?: string | null;
      maxDepth?: number;
    },
    currentDepth = 0,
  ): ProcedureTreeNode[] {
    const children: ProcedureTreeNode[] = [];

    // Check depth limit
    if (filters?.maxDepth !== undefined && currentDepth >= filters.maxDepth) {
      return children;
    }

    // Find direct children
    for (const [id, proc] of procedures) {
      if (proc.parentId === rootId) {
        // Apply filters
        if (filters?.statusFilter && proc.status !== filters.statusFilter) continue;
        if (filters?.typeFilter && proc.type !== filters.typeFilter) continue;
        if (
          filters?.nameFilter &&
          !proc.name.toLowerCase().includes(filters.nameFilter.toLowerCase())
        )
          continue;

        const subtree = this.buildSubtree(id, procedures, filters, currentDepth + 1);
        children.push({
          id,
          name: proc.name,
          type: proc.type,
          status: proc.status,
          startTime: proc.startTime,
          endTime: proc.endTime,
          durationMs: proc.durationMs,
          error: proc.error,
          children: subtree.length > 0 ? subtree : undefined,
        });
      }
    }

    // Sort by start time
    children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

    return children;
  }

  private getAncestry(procedureId: string, procedures: Map<string, ProcedureInfo>): string[] {
    const ancestry: string[] = [];
    let currentId: string | undefined = procedureId;

    while (currentId) {
      const proc = procedures.get(currentId);
      if (!proc) break;

      if (proc.parentId && procedures.has(proc.parentId)) {
        const parent = procedures.get(proc.parentId)!;
        ancestry.unshift(`${parent.name} (${proc.parentId.slice(0, 8)}...)`);
        currentId = proc.parentId;
      } else {
        break;
      }
    }

    return ancestry;
  }

  /**
   * Handle POST /events - receive events from remote engines
   *
   * Security measures:
   * - Token authentication (if secret configured)
   * - Rate limiting per IP
   * - Payload size limit (1MB)
   * - Event structure validation
   */
  private handlePostEvent(req: IncomingMessage, res: ServerResponse): void {
    const ip = this.getClientIp(req);

    // Check authentication
    if (!this.verifyAuth(req)) {
      this.log(`Unauthorized POST from ${ip}`);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // Check rate limit
    if (!this.checkRateLimit(ip)) {
      this.log(`Rate limited POST from ${ip}`);
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too many requests" }));
      return;
    }

    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      // Limit body size to 1MB
      if (body.length > 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        const event = JSON.parse(body) as DevToolsEvent;

        // Validate event structure
        if (!this.validateEvent(event)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid event structure" }));
          return;
        }

        // Emit the event to all connected SSE clients
        this.emit(event);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });

    req.on("error", () => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request error" }));
    });
  }

  /**
   * Validate event structure to prevent malicious payloads
   */
  private validateEvent(event: unknown): event is DevToolsEvent {
    if (!event || typeof event !== "object") return false;

    const e = event as Record<string, unknown>;

    // Required fields
    if (typeof e.type !== "string" || e.type.length === 0 || e.type.length > 50) return false;
    if (
      typeof e.executionId !== "string" ||
      e.executionId.length === 0 ||
      e.executionId.length > 100
    )
      return false;
    if (typeof e.timestamp !== "number" || e.timestamp < 0) return false;

    // Validate type is one of known types
    const validTypes = [
      "execution_start",
      "execution_end",
      "tick_start",
      "tick_end",
      "compiled",
      "model_start",
      "model_request",
      "provider_request",
      "provider_response",
      "model_response",
      "content_delta",
      "reasoning_delta",
      "tool_call",
      "tool_result",
      "tool_confirmation",
      "state_change",
      // Procedure events (from kernel-level observability)
      "procedure_start",
      "procedure_end",
      "procedure_error",
    ];
    if (!validTypes.includes(e.type)) return false;

    // Tick-scoped events need tick number
    const tickEvents = [
      "tick_start",
      "tick_end",
      "compiled",
      "model_start",
      "provider_response",
      "model_response",
      "content_delta",
      "reasoning_delta",
      "tool_call",
      "tool_result",
      "tool_confirmation",
      "state_change",
    ];
    if (tickEvents.includes(e.type) && (typeof e.tick !== "number" || e.tick < 0)) return false;

    return true;
  }

  private handleStatic(pathname: string, res: ServerResponse): void {
    // Map root to index.html
    if (pathname === "/") {
      pathname = "/index.html";
    }

    // Look for UI files in dist/ui (built) or serve a placeholder
    const uiPath = join(__dirname, "../../ui/dist", pathname);
    const placeholderPath = join(__dirname, "../ui", pathname);

    let filePath: string | null = null;
    if (existsSync(uiPath)) {
      filePath = uiPath;
    } else if (existsSync(placeholderPath)) {
      filePath = placeholderPath;
    }

    if (filePath) {
      const ext = pathname.split(".").pop() || "html";
      const contentTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
        ico: "image/x-icon",
      };

      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(readFileSync(filePath));
    } else {
      // Serve a basic HTML page if UI not built yet
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(this.getPlaceholderHtml());
    }
  }

  private getPlaceholderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIDK DevTools</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
    }
    h1 { margin-bottom: 20px; color: #4da6ff; }
    .events {
      font-family: monospace;
      font-size: 13px;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }
    .event {
      padding: 8px 12px;
      margin: 4px 0;
      background: #252542;
      border-radius: 4px;
      border-left: 3px solid #4da6ff;
    }
    .event.execution_start { border-color: #4caf50; }
    .event.execution_end { border-color: #f44336; }
    .event.tick_start { border-color: #ff9800; }
    .event.tick_end { border-color: #ff9800; }
    .event.tool_call { border-color: #9c27b0; }
    .event.tool_result { border-color: #9c27b0; }
    .event-type { color: #4da6ff; font-weight: bold; }
    .event-time { color: #888; font-size: 11px; }
    .event-data { color: #aaa; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>AIDK DevTools</h1>
  <div class="events" id="events"></div>
  <script>
    const eventsEl = document.getElementById('events');
    const es = new EventSource('/events');

    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'connected') return;

      const div = document.createElement('div');
      div.className = 'event ' + event.type;
      div.innerHTML = \`
        <span class="event-type">\${event.type}</span>
        <span class="event-time">\${new Date(event.timestamp).toLocaleTimeString()}</span>
        \${event.executionId ? \`<span style="color:#666"> | exec:\${event.executionId.slice(0,8)}</span>\` : ''}
        \${event.tick !== undefined ? \`<span style="color:#666"> | tick:\${event.tick}</span>\` : ''}
        <div class="event-data">\${JSON.stringify(event, null, 2).slice(0, 500)}</div>
      \`;
      eventsEl.insertBefore(div, eventsEl.firstChild);
    };

    es.onerror = () => console.log('SSE error, reconnecting...');
  </script>
</body>
</html>`;
  }
}
