#!/usr/bin/env node
/**
 * AIDK DevTools CLI
 *
 * Usage:
 *   npx aidk-devtools [options]
 *   pnpm exec aidk-devtools [options]
 *
 * Options:
 *   --port, -p     Port to listen on (default: 3001)
 *   --host         Host to bind to (default: 127.0.0.1)
 *   --secret, -s   Secret token for POST authentication
 *   --open, -o     Auto-open browser
 *   --debug, -d    Enable debug logging
 *   --help, -h     Show help
 */

import { getDevToolsServer } from "./server/index.js";

interface ParsedArgs {
  port: number;
  host: string;
  secret?: string;
  open: boolean;
  debug: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    port: 3001,
    host: "127.0.0.1",
    secret: undefined,
    open: false,
    debug: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--open" || arg === "-o") {
      result.open = true;
    } else if (arg === "--debug" || arg === "-d") {
      result.debug = true;
    } else if (arg === "--port" || arg === "-p") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result.port = parseInt(nextArg, 10);
        i++;
      }
    } else if (arg.startsWith("--port=")) {
      result.port = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--host") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result.host = nextArg;
        i++;
      }
    } else if (arg.startsWith("--host=")) {
      result.host = arg.split("=")[1];
    } else if (arg === "--secret" || arg === "-s") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        result.secret = nextArg;
        i++;
      }
    } else if (arg.startsWith("--secret=")) {
      result.secret = arg.split("=")[1];
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
AIDK DevTools

Usage:
  npx aidk-devtools [options]

Options:
  --port, -p <port>   Port to listen on (default: 3001)
  --host <host>       Host to bind to (default: 127.0.0.1)
  --secret, -s <tok>  Secret token for POST /events authentication
  --open, -o          Auto-open browser
  --debug, -d         Enable debug logging
  --help, -h          Show this help message

Security:
  By default, the server only binds to localhost (127.0.0.1).
  If you need to expose it to other hosts, use --host 0.0.0.0
  and consider setting a --secret for authentication.

Examples:
  npx aidk-devtools
  npx aidk-devtools --port 8080 --open
  npx aidk-devtools -p 3002 -o -d
  npx aidk-devtools --host 0.0.0.0 --secret my-secret-token
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  console.log(`
╔═══════════════════════════════════════╗
║          AIDK DevTools                ║
╚═══════════════════════════════════════╝
`);

  const server = getDevToolsServer({
    port: args.port,
    host: args.host,
    secret: args.secret,
    debug: args.debug,
    open: args.open,
  });

  const url = `http://${args.host === "0.0.0.0" ? "localhost" : args.host}:${args.port}`;

  console.log(`Server running at: ${url}`);
  if (args.host !== "127.0.0.1" && args.host !== "localhost") {
    console.log(`⚠️  Bound to ${args.host} - accessible from network`);
  }
  if (args.secret) {
    console.log(`🔐 Authentication enabled (secret required for POST /events)`);
  }
  console.log(`Waiting for engine events...\n`);

  console.log(`Connect your AIDK engine:\n`);
  console.log(`  // Same process (import devtools)`);
  console.log(`  import { initDevTools } from 'aidk-devtools';`);
  console.log(`  initDevTools({ port: ${args.port} });\n`);

  console.log(`  // Different process (remote mode)`);
  console.log(`  const engine = createEngine({`);
  console.log(`    devTools: {`);
  console.log(`      remote: true,`);
  console.log(`      remoteUrl: '${url}',`);
  if (args.secret) {
    console.log(`      secret: '<your-secret>',`);
  }
  console.log(`    },`);
  console.log(`  });\n`);

  // LLM/Agent-friendly API info
  console.log(`📡 LLM-Friendly API (for AI agents):\n`);
  if (args.secret) {
    console.log(`  # All API endpoints require authentication when secret is set`);
    console.log(`  # Add header: -H "Authorization: Bearer <secret>"\n`);
  }
  const curlAuth = args.secret ? ` -H "Authorization: Bearer <secret>"` : "";
  console.log(`  # Overview`);
  console.log(`  curl${curlAuth} ${url}/api/summary`);
  console.log(`  curl${curlAuth} ${url}/api/executions\n`);
  console.log(`  # Drill into an execution (get full procedure tree)`);
  console.log(`  curl${curlAuth} ${url}/api/executions/<id>/tree\n`);
  console.log(`  # Drill into a procedure (get subtree + ancestry)`);
  console.log(`  curl${curlAuth} ${url}/api/procedures/<id>/tree\n`);
  console.log(`  # Specialized queries`);
  console.log(`  curl${curlAuth} ${url}/api/errors`);
  console.log(`  curl${curlAuth} ${url}/api/tools\n`);
  console.log(`  # Raw event filtering`);
  console.log(`  curl${curlAuth} "${url}/api/events?type=tool_call&limit=50"\n`);

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Error starting devtools:", err);
  process.exit(1);
});
