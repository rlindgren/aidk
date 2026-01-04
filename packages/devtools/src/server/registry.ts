/**
 * DevTools Registry
 *
 * Singleton manager for the devtools server.
 * Ensures only one server instance exists per process and handles cleanup.
 *
 * The registry subscribes to the devToolsEmitter singleton from aidk-shared
 * to receive events emitted by the engine. Events are forwarded to the
 * DevToolsServer which broadcasts them to connected UI clients.
 */
import { DevToolsServer, type DevToolsServerConfig } from "./devtools-server";
import { devToolsEmitter, type DevToolsEvent } from "aidk-shared";

// HMR-safe global symbols - survive module reloads
const INSTANCE_KEY = Symbol.for("aidk.devtools.instance");
const HANDLERS_KEY = Symbol.for("aidk.devtools.handlers");
const UNSUBSCRIBE_KEY = Symbol.for("aidk.devtools.unsubscribe");

interface GlobalWithDevTools {
  [INSTANCE_KEY]?: DevToolsServer | null;
  [HANDLERS_KEY]?: {
    exit: () => void;
    sigint: () => void;
    sigterm: () => void;
  } | null;
  [UNSUBSCRIBE_KEY]?: (() => void) | null;
}

const globalRef = globalThis as GlobalWithDevTools;

// Use Symbol-keyed globals for HMR safety
let instance: DevToolsServer | null = globalRef[INSTANCE_KEY] ?? null;
let emitterUnsubscribe: (() => void) | null = globalRef[UNSUBSCRIBE_KEY] ?? null;

export interface DevToolsOptions extends DevToolsServerConfig {
  /** Auto-open browser when server starts */
  open?: boolean;
}

/**
 * Get or create the singleton devtools server.
 * First call starts the server, subsequent calls return the same instance.
 */
export function getDevToolsServer(options: DevToolsOptions = {}): DevToolsServer {
  if (!instance) {
    const { open, ...serverConfig } = options;

    instance = new DevToolsServer(serverConfig);
    globalRef[INSTANCE_KEY] = instance;
    instance.start();

    const url = instance.getUrl();
    console.log(`\n🔧 DevTools: ${url}\n`);

    // Subscribe to devToolsEmitter to forward engine events to the server
    // This allows engines that emit via devToolsEmitter to have their events
    // broadcast to connected UI clients automatically
    emitterUnsubscribe = devToolsEmitter.subscribe((event) => {
      instance?.emit(event);
    });
    globalRef[UNSUBSCRIBE_KEY] = emitterUnsubscribe;

    // Auto-open browser if requested
    if (open) {
      import("open")
        .then(({ default: openBrowser }) => openBrowser(url))
        .catch(() => {
          // open package not available, ignore
        });
    }

    // Remove old handlers if they exist (HMR safety)
    const existingHandlers = globalRef[HANDLERS_KEY];
    if (existingHandlers) {
      process.off("exit", existingHandlers.exit);
      process.off("SIGINT", existingHandlers.sigint);
      process.off("SIGTERM", existingHandlers.sigterm);
    }

    // Create and register new cleanup handlers
    const cleanup = () => {
      if (emitterUnsubscribe) {
        emitterUnsubscribe();
        emitterUnsubscribe = null;
        globalRef[UNSUBSCRIBE_KEY] = null;
      }
      if (instance) {
        instance.stop();
        instance = null;
        globalRef[INSTANCE_KEY] = null;
      }
    };

    const exitHandler = () => cleanup();
    const sigintHandler = () => {
      cleanup();
      process.exit(0);
    };
    const sigtermHandler = () => {
      cleanup();
      process.exit(0);
    };

    // Store handler references for cleanup on HMR
    globalRef[HANDLERS_KEY] = {
      exit: exitHandler,
      sigint: sigintHandler,
      sigterm: sigtermHandler,
    };

    process.on("exit", exitHandler);
    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);
  }

  return instance;
}

/**
 * Emit an event to the devtools server.
 * No-op if devtools is not initialized.
 */
export function emitDevToolsEvent(event: DevToolsEvent): void {
  instance?.emit(event);
}

/**
 * Check if devtools is currently running
 */
export function isDevToolsActive(): boolean {
  return instance !== null;
}

/**
 * Stop the devtools server (for testing or explicit shutdown)
 */
export function stopDevTools(): void {
  // Clean up emitter subscription
  if (emitterUnsubscribe) {
    emitterUnsubscribe();
    emitterUnsubscribe = null;
    globalRef[UNSUBSCRIBE_KEY] = null;
  }

  // Clean up process handlers
  const handlers = globalRef[HANDLERS_KEY];
  if (handlers) {
    process.off("exit", handlers.exit);
    process.off("SIGINT", handlers.sigint);
    process.off("SIGTERM", handlers.sigterm);
    globalRef[HANDLERS_KEY] = null;
  }

  // Stop the server
  if (instance) {
    instance.stop();
    instance = null;
    globalRef[INSTANCE_KEY] = null;
  }
}
