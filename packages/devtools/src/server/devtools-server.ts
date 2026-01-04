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
import type { DevToolsEvent } from "../events";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DevToolsServerConfig {
  /** Port to listen on (default: 3001) */
  port?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
}

interface SSEClient {
  res: ServerResponse;
  heartbeatInterval: NodeJS.Timeout;
}

export class DevToolsServer {
  private server: Server | null = null;
  private clients = new Set<SSEClient>();
  private config: Required<DevToolsServerConfig>;
  private eventHistory: DevToolsEvent[] = [];
  private maxHistorySize = 1000;

  constructor(config: DevToolsServerConfig = {}) {
    this.config = {
      port: config.port ?? 3001,
      debug: config.debug ?? false,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
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

    this.server.listen(this.config.port, () => {
      this.log(`Server listening on port ${this.config.port}`);
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

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || "/", `http://localhost:${this.config.port}`);

    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route handling
    if (url.pathname === "/events") {
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
