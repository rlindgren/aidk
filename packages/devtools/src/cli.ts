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
 *   --open, -o     Auto-open browser
 *   --debug, -d    Enable debug logging
 *   --help, -h     Show help
 */

import { getDevToolsServer } from "./server";

function parseArgs(args: string[]): { port: number; open: boolean; debug: boolean; help: boolean } {
  const result = { port: 3001, open: false, debug: false, help: false };

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
  --open, -o          Auto-open browser
  --debug, -d         Enable debug logging
  --help, -h          Show this help message

Examples:
  npx aidk-devtools
  npx aidk-devtools --port 8080 --open
  npx aidk-devtools -p 3002 -o -d
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
    debug: args.debug,
    open: args.open,
  });

  console.log(`Server started. Waiting for engine events...`);
  console.log(`Connect your AIDK engine with: devTools: true\n`);

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
