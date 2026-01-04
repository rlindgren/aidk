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
    } else if (url.pathname === "/api/history") {
      this.handleHistory(res);
    } else {
      this.handleStatic(url.pathname, res);
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
      "model_output",
      "content_delta",
      "reasoning_delta",
      "tool_call",
      "tool_result",
      "tool_confirmation",
      "state_change",
    ];
    if (!validTypes.includes(e.type)) return false;

    // Tick-scoped events need tick number
    const tickEvents = [
      "tick_start",
      "tick_end",
      "compiled",
      "model_start",
      "model_output",
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
