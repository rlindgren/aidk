/**
 * Fiber Compiler
 *
 * Tick-based agent architecture compiler. Designed for AI agent execution:
 * - Async-first (all phases can be async)
 * - No concurrent mode (we can wait, no UI to freeze)
 * - Tick lifecycle (tickStart → render → compile → tickEnd)
 * - Supports both function components (with hooks) and class components
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Logger } from "aidk-kernel";
import { isContentBlock, isHostPrimitive as isHostPrimitiveSymbol } from "aidk-shared";
import type { COM } from "../com/object-model";
import type {
  TickState,
  AfterCompileContext,
  RecoveryAction,
  EngineComponent,
} from "../component/component";
import type { ExecutionMessage } from "../engine/execution-types";
import type { JSX } from "../jsx/jsx-runtime";
import { isElement, Fragment } from "../jsx/jsx-runtime";
import type { CompiledStructure, CompiledSection, CompiledTimelineEntry } from "./types";
import type { ContentRenderer, SemanticContentBlock } from "../renderers";
import { MarkdownRenderer } from "../renderers";
import { Section, Tool, Entry, Ephemeral, Timeline } from "../jsx/components/primitives";
import { Text, Code, Image, Json, Document, Audio, Video } from "../jsx/components/content";
import { Renderer } from "../jsx/components/renderer";
import { bindCOMSignals, cleanupSignals, PROPS_SIGNAL_SYMBOL } from "../state";
import type { Signal } from "../state/signal";
import { initializeContentBlockMappers, type ContentBlockMapper } from "./content-block-registry";
import { extractSemanticNodeFromElement } from "./extractors";
import {
  ComponentHookRegistry,
  type ComponentHookName,
  getComponentTags,
  getComponentName,
} from "../component/component-hooks";
import { createEngineProcedure } from "../procedure";

import type {
  FiberNode,
  FiberCompilerConfig,
  FunctionComponent,
  ClassComponent,
  ComponentType,
  ComponentInstance,
  Effect,
  RenderContext,
  FiberChild,
  NormalizedChild,
  CompileResult,
} from "./types";
import { FiberFlags, EffectPhase, HookTag } from "./types";
import { createFiber, createWorkInProgress, getChildFibers, traverseFiber } from "./fiber";
import { setRenderContext, setScheduleWork } from "../state/hooks";

const log = Logger.for("FiberCompiler");

// Fragment symbol for cross-module identity
const FragmentSymbol = Symbol.for("aidk.fragment");

function isFragment(type: unknown): type is symbol {
  return (
    type === Fragment ||
    type === FragmentSymbol ||
    (typeof type === "symbol" && (type as symbol).description === "aidk.fragment")
  );
}

// ============================================================================
// Fiber Compiler
// ============================================================================

// Compiler context storage - maintains separate compiler context per async execution chain
// This prevents race conditions when multiple engine instances compile concurrently
const compilerContext = new AsyncLocalStorage<FiberCompiler>();

/**
 * Check if any compiler is currently in render phase.
 * Used by signal handlers to detect render-time state changes.
 * Thread-safe: uses AsyncLocalStorage to maintain separate context per execution.
 */
export function isCompilerRendering(): boolean {
  return compilerContext.getStore()?.isRenderingNow() ?? false;
}

/**
 * Check if any compiler is currently in tickStart phase.
 * Used by signal handlers to skip recompiles (render is about to happen anyway).
 * Thread-safe: uses AsyncLocalStorage to maintain separate context per execution.
 */
export function isCompilerInTickStart(): boolean {
  return compilerContext.getStore()?.isInTickStart() ?? false;
}

/**
 * Check if any compiler is currently in tickEnd phase.
 * Used by signal handlers to skip recompiles (current tick is done, next tick will see updates).
 * Thread-safe: uses AsyncLocalStorage to maintain separate context per execution.
 */
export function isCompilerInTickEnd(): boolean {
  return compilerContext.getStore()?.isInTickEnd() ?? false;
}

/**
 * Check if any compiler is currently in a phase where recompiles should be skipped.
 * Thread-safe: uses AsyncLocalStorage to maintain separate context per execution.
 */
export function shouldSkipRecompile(): boolean {
  return compilerContext.getStore()?.shouldSkipRecompile() ?? false;
}

/**
 * Get the active compiler instance (for requesting recompile).
 * Thread-safe: uses AsyncLocalStorage to maintain separate context per execution.
 */
export function getActiveCompiler(): FiberCompiler | null {
  return compilerContext.getStore() ?? null;
}

export class FiberCompiler {
  // Tree state
  private current: FiberNode | null = null;
  private workInProgress: FiberNode | null = null;

  // Context
  private com: COM;
  private tickState: TickState | null = null;

  // Rendering
  private defaultRenderer: ContentRenderer = new MarkdownRenderer();
  private contentBlockMappers = new Map<unknown, ContentBlockMapper>();

  // Effect queues (by phase)
  private effectsByPhase = new Map<EffectPhase, Effect[]>();
  private afterCompileCallbacks: Array<(compiled: CompiledStructure) => void> = [];

  // Work scheduling
  private pendingWork: FiberNode[] = [];
  private isRendering = false;
  private currentPhase:
    | "idle"
    | "tickStart"
    | "render"
    | "compile"
    | "tickEnd"
    | "mount"
    | "complete"
    | "unmount" = "idle";

  // Component lifecycle middleware
  private hookRegistry?: ComponentHookRegistry;
  private wrappedMethods = new WeakMap<object, Map<string, Function>>();

  // Config
  private config: FiberCompilerConfig;

  constructor(com: COM, hookRegistry?: ComponentHookRegistry, config: FiberCompilerConfig = {}) {
    this.com = com;
    this.hookRegistry = hookRegistry;
    this.config = {
      dev: config.dev ?? process.env["NODE_ENV"] === "development",
      maxCompileIterations: config.maxCompileIterations ?? 10,
      asyncEffects: config.asyncEffects ?? true,
      ...config,
    };

    // Set default renderer from config
    this.defaultRenderer = config.defaultRenderer || new MarkdownRenderer();

    // Set up work scheduling
    setScheduleWork((fiber: FiberNode) => {
      this.scheduleWork(fiber);
    });

    // Initialize content block mappers
    this.initializeContentBlockMappers();
  }

  /**
   * Check if this compiler is currently rendering.
   * Used by signal handlers to detect render-time state changes.
   */
  isRenderingNow(): boolean {
    return this.isRendering;
  }

  /**
   * Check if this compiler is currently in tickStart phase.
   * Used by signal handlers to skip recompiles (render is about to happen anyway).
   */
  isInTickStart(): boolean {
    return this.currentPhase === "tickStart";
  }

  /**
   * Check if this compiler is currently in tickEnd phase.
   * Used by signal handlers to skip recompiles (current tick is done, next tick will see updates).
   */
  isInTickEnd(): boolean {
    return this.currentPhase === "tickEnd";
  }

  /**
   * Check if this compiler is currently in a phase where recompiles should be skipped.
   * Used by signal handlers to avoid unnecessary recompiles.
   *
   * Phases where we skip:
   * - tickStart: Render is about to happen anyway
   * - tickEnd: Current tick is done, next tick will see the update
   * - complete: Execution is complete, no more renders
   * - unmount: Component is being removed
   * - render (class onMount): Class component onMount runs during render, before render() is called
   *
   * Phases where we allow recompile:
   * - mount (useOnMount): Function component useOnMount runs after first render, can trigger recompile
   * - render (function components): Function components can trigger recompile during render
   */
  shouldSkipRecompile(): boolean {
    return (
      this.currentPhase === "tickStart" ||
      this.currentPhase === "tickEnd" ||
      this.currentPhase === "complete" ||
      this.currentPhase === "unmount" ||
      (this.currentPhase === "render" && this.isRendering)
    ); // Class component onMount runs during render, before render() is called
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Compile JSX element into CompiledStructure.
   * Runs within AsyncLocalStorage context to ensure thread-safe compiler access.
   */
  async compile(element: JSX.Element, state: TickState): Promise<CompiledStructure> {
    // Run compilation within compiler context to maintain isolation
    return compilerContext.run(this, async () => {
      this.tickState = state;
      this.resetEffectQueues();

      try {
        // Create or update root fiber
        if (this.current === null) {
          this.workInProgress = createFiber(element.type, element.props || {}, element.key);
          this.workInProgress.flags |= FiberFlags.Placement;
        } else {
          this.workInProgress = createWorkInProgress(this.current, element.props || {});
        }

        // Phase 1: Render - build fiber tree
        this.currentPhase = "render";
        this.isRendering = true;
        await this.performRender(this.workInProgress, element);
        this.isRendering = false;
        this.currentPhase = "compile";

        // Phase 2: Commit - run effects
        await this.commitWork();

        // Swap buffers
        this.current = this.workInProgress;
        this.workInProgress = null;

        // Phase 3: Collect structures
        this.currentPhase = "idle";
        return this.collectStructures(this.current);
      } catch (error) {
        this.workInProgress = null;
        this.isRendering = false;
        this.currentPhase = "idle";
        throw error;
      }
    });
  }

  /**
   * Compile until stable (no recompile requests).
   */
  async compileUntilStable(
    element: JSX.Element,
    state: TickState,
    options: { maxIterations?: number } = {},
  ): Promise<CompileResult> {
    const maxIterations = options.maxIterations ?? this.config.maxCompileIterations!;
    const recompileReasons: string[] = [];
    let iterations = 0;
    let compiled: CompiledStructure;

    do {
      this.com._resetRecompileRequest();

      try {
        compiled = await this.compile(element, state);

        // Run afterCompile callbacks
        const ctx: AfterCompileContext = {
          iteration: iterations,
          maxIterations,
        };

        for (const callback of this.afterCompileCallbacks) {
          callback(compiled);
        }

        // Also notify class components
        await this.notifyAfterCompile(compiled, state, ctx);
      } finally {
        // Always clear callbacks, even on error, to prevent stale callbacks
        // from being invoked on subsequent compilations
        this.afterCompileCallbacks = [];
      }

      // Collect recompile reasons
      const reasons = this.com._getRecompileReasons();
      for (const reason of reasons) {
        recompileReasons.push(`[iteration ${iterations}] ${reason}`);
      }

      iterations++;

      if (!this.com._wasRecompileRequested()) {
        break;
      }

      if (iterations >= maxIterations) {
        log.warn(
          { maxIterations, reasons: recompileReasons },
          "Compilation stabilization hit max iterations",
        );
        break;
      }
    } while (true);

    return {
      compiled: compiled!,
      iterations,
      forcedStable: iterations >= maxIterations && this.com._wasRecompileRequested(),
      recompileReasons,
    };
  }

  // ============================================================================
  // Lifecycle Notifications
  // ============================================================================

  async notifyStart(): Promise<void> {
    await traverseFiber(this.current, async (fiber) => {
      if (fiber.stateNode?.onStart) {
        const wrapped = this.getWrappedMethod(fiber.stateNode, "onStart");
        await wrapped(this.com);
      }
    });
  }

  async notifyTickStart(state: TickState): Promise<void> {
    this.tickState = state;
    this.currentPhase = "tickStart";

    try {
      // Run tick start effects from function components
      await this.runEffects(EffectPhase.TickStart);

      // Call class component onTickStart
      await traverseFiber(this.current, async (fiber) => {
        if (fiber.stateNode?.onTickStart) {
          try {
            const wrapped = this.getWrappedMethod(fiber.stateNode, "onTickStart");
            await wrapped(this.com, state);
          } catch (err) {
            const instanceName = fiber.stateNode.constructor?.name || "unknown";
            log.error({ err, component: instanceName }, "onTickStart error");
          }
        }
      });

      // Re-register tools from the fiber tree
      // This ensures tools match the current JSX tree, supporting conditional tool rendering
      // and handling module identity issues where onTickStart inheritance may not work
      await this.reregisterToolsFromFibers(this.current);
    } finally {
      this.currentPhase = "idle";
    }
  }

  async notifyTickEnd(state: TickState): Promise<void> {
    this.currentPhase = "tickEnd";

    try {
      // Run tick end effects
      await this.runEffects(EffectPhase.TickEnd);

      // Call class component onTickEnd
      await traverseFiber(this.current, async (fiber) => {
        if (fiber.stateNode?.onTickEnd) {
          try {
            const wrapped = this.getWrappedMethod(fiber.stateNode, "onTickEnd");
            await wrapped(this.com, state);
          } catch (error: unknown) {
            // If component has onError handler, call it
            if (fiber.stateNode?.onError) {
              const errorState: TickState = {
                ...state,
                error: {
                  error: error instanceof Error ? error : new Error(String(error)),
                  phase: "tick_end",
                  recoverable: true,
                },
              };
              const errorWrapped = this.getWrappedMethod(fiber.stateNode, "onError");
              await errorWrapped(this.com, errorState);
            } else {
              // Re-throw if no error handler
              throw error;
            }
          }
        }
      });
    } finally {
      this.currentPhase = "idle";
    }
  }

  async notifyError(state: TickState): Promise<RecoveryAction | null> {
    const recoveryActions: RecoveryAction[] = [];
    await traverseFiber(this.current, async (fiber) => {
      if (fiber.stateNode?.onError) {
        try {
          const wrapped = this.getWrappedMethod(fiber.stateNode, "onError");
          const recovery = await wrapped(this.com, state);
          if (recovery) {
            recoveryActions.push(recovery);
          }
        } catch (error: unknown) {
          // If onError itself throws, log but don't propagate (to allow other components to handle)
          log.error({ err: error }, "Error in component onError handler");
        }
      }
    });

    // Return the first recovery action that wants to continue, or null
    return recoveryActions.find((action) => action.continue) || null;
  }

  async notifyAfterCompile(
    compiled: CompiledStructure,
    state: TickState,
    ctx: AfterCompileContext,
  ): Promise<void> {
    await traverseFiber(this.current, async (fiber) => {
      // Class components
      if (fiber.stateNode?.onAfterCompile) {
        const instanceName = fiber.stateNode.constructor?.name || "unknown";
        try {
          const wrapped = this.getWrappedMethod(fiber.stateNode, "onAfterCompile");
          await wrapped(this.com, compiled, state, ctx);
        } catch (err) {
          log.error({ err, component: instanceName }, "onAfterCompile error");
        }
      }

      // Function components with useAfterCompile
      let hook = fiber.memoizedState;
      while (hook !== null) {
        if (hook.tag === HookTag.AfterCompile && typeof hook.memoizedState === "function") {
          hook.memoizedState(this.com, compiled, state);
        }
        hook = hook.next;
      }
    });
  }

  async notifyComplete(finalState: unknown): Promise<void> {
    this.currentPhase = "complete";
    try {
      await traverseFiber(this.current, async (fiber) => {
        if (fiber.stateNode?.onComplete) {
          const wrapped = this.getWrappedMethod(fiber.stateNode, "onComplete");
          await wrapped(this.com, finalState);
        }
      });
    } finally {
      this.currentPhase = "idle";
    }
  }

  /**
   * Notify components of an incoming execution message.
   *
   * Called immediately when a message is sent to the execution via
   * CompileSession.sendMessage() or ExecutionHandle.send().
   *
   * This traverses the fiber tree and calls:
   * - Class component onMessage() methods
   * - Function component useOnMessage() hooks
   *
   * @param message The execution message
   * @param state Current tick state
   */
  async notifyOnMessage(message: ExecutionMessage, state: TickState): Promise<void> {
    if (!this.current) {
      return; // No fiber tree yet
    }

    await traverseFiber(this.current, async (fiber) => {
      // Class components with onMessage
      if (fiber.stateNode?.onMessage) {
        try {
          const wrapped = this.getWrappedMethod(fiber.stateNode, "onMessage");
          await wrapped(this.com, message, state);
        } catch (err) {
          const instanceName = fiber.stateNode.constructor?.name || "unknown";
          log.error({ err, component: instanceName }, "onMessage error");
        }
      }

      // Function components with useOnMessage
      let hook = fiber.memoizedState;
      while (hook !== null) {
        if (hook.tag === HookTag.OnMessage && typeof hook.memoizedState === "function") {
          try {
            await hook.memoizedState(this.com, message, state);
          } catch (err) {
            log.error({ err }, "useOnMessage callback error");
          }
        }
        hook = hook.next;
      }
    });
  }

  async unmount(): Promise<void> {
    if (this.current) {
      await this.unmountFiber(this.current);
      this.current = null;
    }
  }

  // ============================================================================
  // Render Phase
  // ============================================================================

  private async performRender(fiber: FiberNode, element: JSX.Element): Promise<void> {
    await this.beginWork(fiber, element);
  }

  private async beginWork(fiber: FiberNode, element: JSX.Element): Promise<void> {
    const { type, props } = element;
    fiber.type = type;
    fiber.props = props || {};

    if (typeof type === "function") {
      // Check if this is a primitive/host component (Section, Message, etc.)
      // These should NOT be called as functions - they're handled directly in traverseAndCollect
      if (this.isHostPrimitive(type)) {
        await this.updatePrimitiveComponent(fiber, props || {});
      } else if (this.isClassComponent(type)) {
        await this.updateClassComponent(fiber, type as ClassComponent, props || {});
      } else {
        await this.updateFunctionComponent(fiber, type as FunctionComponent, props || {});
      }
    } else if (isFragment(type)) {
      await this.reconcileChildren(fiber, this.normalizeChildren(props?.children));
    } else if (typeof type === "string") {
      await this.updateHostComponent(fiber, type, props || {});
    } else if (typeof type === "object" && type !== null) {
      // Direct instance
      await this.updateDirectInstance(fiber, type as ComponentInstance, props || {});
    }
  }

  // ============================================================================
  // Component Updates
  // ============================================================================

  private async updateFunctionComponent(
    fiber: FiberNode,
    Component: FunctionComponent,
    props: Record<string, unknown>,
  ): Promise<void> {
    // Set up render context for hooks
    const ctx: RenderContext = {
      fiber,
      com: this.com,
      tickState: this.tickState!,
      currentHook: fiber.alternate?.memoizedState ?? null,
      workInProgressHook: null,
    };

    setRenderContext(ctx);

    try {
      // Call the function component (may be async)
      let children: FiberChild;

      if (Component.length >= 3) {
        children = await (
          Component as (p: unknown, c: COM, s: TickState) => FiberChild | Promise<FiberChild>
        )(props, this.com, this.tickState!);
      } else if (Component.length === 2) {
        children = await (Component as (p: unknown, c: COM) => FiberChild | Promise<FiberChild>)(
          props,
          this.com,
        );
      } else {
        children = await (Component as (p: unknown) => FiberChild | Promise<FiberChild>)(props);
      }

      // Hook chain is already saved in fiber.memoizedState during hook calls
      // (set by mountWorkInProgressHook when first hook is called)
      // No need to overwrite it here - workInProgressHook points to the LAST hook, not the HEAD

      // Collect effects from hooks
      this.collectEffectsFromFiber(fiber);

      // Check for self-referential components (e.g., `function Paragraph(props) { return createElement(Paragraph, props); }`)
      // These are "terminal" primitive markers that should not be recursed into
      // This handles semantic components (Paragraph, Header, etc.) that aren't core structural primitives
      const isSelfReferential =
        isElement(children) &&
        ((children as JSX.Element).type === Component ||
          (children as JSX.Element).type?.name === Component.name);

      if (isSelfReferential) {
        // Self-referential component is a primitive marker - treat as terminal
        // Don't recurse into the element itself (would cause infinite loop)
        // BUT reconcile its children from props.children
        const element = children as JSX.Element;
        if (element.props?.children !== undefined) {
          await this.reconcileChildren(fiber, this.normalizeChildren(element.props.children));
        } else {
          fiber.child = null;
        }
        return;
      }

      // Reconcile children
      // If function component returns a single JSX element, reconcile it directly
      // Otherwise normalize and reconcile the children
      if (children !== null && children !== undefined) {
        if (isElement(children)) {
          // Single JSX element returned - reconcile it as the only child
          // Use fiber.alternate?.child to reuse previous child fiber
          const oldChildFiber = fiber.alternate?.child ?? null;
          const childFiber = await this.reconcileElement(
            fiber,
            oldChildFiber,
            children as JSX.Element,
            0,
          );
          if (childFiber) {
            childFiber.parent = fiber;
            childFiber.index = 0;
            fiber.child = childFiber;
          } else {
            fiber.child = null;
          }
        } else {
          // Array, primitive, or content block - normalize and reconcile
          await this.reconcileChildren(fiber, this.normalizeChildren(children));
        }
      } else {
        fiber.child = null;
      }
    } finally {
      setRenderContext(null);
    }
  }

  private async updateClassComponent(
    fiber: FiberNode,
    ComponentClass: ClassComponent,
    props: Record<string, unknown>,
  ): Promise<void> {
    let instance = fiber.stateNode;

    if (instance === null) {
      // Mount
      instance = new ComponentClass(props);
      fiber.stateNode = instance;
      fiber.flags |= FiberFlags.Placement;

      this.setupComponentInfrastructure(instance, props);
      this.wrapComponentMethods(instance);

      // Register static tool if present on the class
      if ((ComponentClass as any).tool) {
        this.registerStaticTool((ComponentClass as any).tool);
      }

      if (instance.onMount) {
        const wrapped = this.getWrappedMethod(instance, "onMount");
        await wrapped(this.com);
      }

      // if (instance.onTickStart && this.tickState) {
      //   const wrapped = this.getWrappedMethod(instance, 'onTickStart');
      //   await wrapped(this.com, this.tickState);
      // }
    } else {
      // Update
      this.updatePropsSignals(instance, props);
      if (Object.keys(props).length > 0) {
        instance.props = { ...instance.props, ...props };
      }
    }

    // Render
    const children = instance.render
      ? await this.getWrappedMethod(instance, "render")(this.com, this.tickState!)
      : null;

    if (children !== null && children !== undefined) {
      await this.reconcileChildren(fiber, this.normalizeChildren(children));
    } else {
      fiber.child = null;
    }
  }

  private async updateDirectInstance(
    fiber: FiberNode,
    instance: ComponentInstance,
    props: Record<string, unknown>,
  ): Promise<void> {
    if (fiber.stateNode === null) {
      fiber.stateNode = instance;
      fiber.flags |= FiberFlags.Placement;

      this.setupComponentInfrastructure(instance, props);
      this.wrapComponentMethods(instance);

      // Register static tool if present on the instance's constructor
      if ((instance.constructor as any)?.tool) {
        this.registerStaticTool((instance.constructor as any).tool);
      }

      if (instance.onMount) {
        const wrapped = this.getWrappedMethod(instance, "onMount");
        await wrapped(this.com);
      }

      // if (instance.onTickStart && this.tickState) {
      //   const wrapped = this.getWrappedMethod(instance, 'onTickStart');
      //   await wrapped(this.com, this.tickState);
      // }
    } else {
      this.updatePropsSignals(instance, props);
    }

    const children = instance.render
      ? await this.getWrappedMethod(instance, "render")(this.com, this.tickState!)
      : null;

    if (children !== null && children !== undefined) {
      await this.reconcileChildren(fiber, this.normalizeChildren(children));
    }
  }

  private async updatePrimitiveComponent(
    fiber: FiberNode,
    props: Record<string, unknown>,
  ): Promise<void> {
    // Primitive components (Section, Entry, etc.) are NOT called as functions
    // They're recognized by traverseAndCollect and have their children reconciled directly
    // The fiber type remains the function reference for identification

    // Note: props.content is handled during collection phase in traverseAndCollect
    // It's stored directly on the section/entry, not reconciled as children
    // Only props.children needs reconciliation here
    if (props.children !== undefined) {
      await this.reconcileChildren(fiber, this.normalizeChildren(props.children));
    } else {
      fiber.child = null;
    }
  }

  private async updateHostComponent(
    fiber: FiberNode,
    _type: string,
    props: Record<string, unknown>,
  ): Promise<void> {
    // Host components just reconcile children
    if (props.children !== undefined) {
      await this.reconcileChildren(fiber, this.normalizeChildren(props.children));
    }
  }

  // ============================================================================
  // Reconciliation
  // ============================================================================

  private async reconcileChildren(parent: FiberNode, children: NormalizedChild[]): Promise<void> {
    const oldChildren = getChildFibers(parent.alternate);

    let previousFiber: FiberNode | null = null;
    let oldIndex = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const oldFiber = oldChildren[oldIndex] ?? null;

      let newFiber: FiberNode | null = null;

      if (child.kind === "element") {
        newFiber = await this.reconcileElement(parent, oldFiber, child.element, i);
        if (oldFiber && this.canReuse(oldFiber, child.element)) {
          oldIndex++;
        }
      } else if (child.kind === "content-block") {
        // Content blocks become special fibers
        newFiber = this.createContentBlockFiber(child.block, i);
      } else if (child.kind === "text") {
        // Text becomes a fiber with string type
        newFiber = createFiber("text", { value: child.text }, null);
      }

      if (newFiber) {
        newFiber.parent = parent;
        newFiber.index = i;

        if (previousFiber === null) {
          parent.child = newFiber;
        } else {
          previousFiber.sibling = newFiber;
        }
        previousFiber = newFiber;
      }
    }

    // Clear sibling chain end
    if (previousFiber) {
      previousFiber.sibling = null;
    } else {
      parent.child = null;
    }

    // Mark remaining old fibers for deletion
    for (let i = oldIndex; i < oldChildren.length; i++) {
      this.markForDeletion(parent, oldChildren[i]);
    }
  }

  private async reconcileElement(
    parent: FiberNode,
    oldFiber: FiberNode | null,
    element: JSX.Element,
    _index: number,
  ): Promise<FiberNode> {
    if (oldFiber && this.canReuse(oldFiber, element)) {
      // Reuse existing fiber
      const workInProgress = createWorkInProgress(oldFiber, element.props || {});
      await this.beginWork(workInProgress, element);
      return workInProgress;
    }

    // Create new fiber
    const newFiber = createFiber(element.type, element.props || {}, element.key);
    newFiber.flags |= FiberFlags.Placement;
    await this.beginWork(newFiber, element);
    return newFiber;
  }

  private canReuse(oldFiber: FiberNode, element: JSX.Element): boolean {
    return oldFiber.type === element.type && oldFiber.key === (element.key ?? null);
  }

  private createContentBlockFiber(block: unknown, index: number): FiberNode {
    return createFiber("content-block", { block }, index);
  }

  private markForDeletion(parent: FiberNode, fiber: FiberNode): void {
    fiber.flags |= FiberFlags.Deletion;
    parent.deletions = parent.deletions ?? [];
    parent.deletions.push(fiber);
  }

  // ============================================================================
  // Commit Phase
  // ============================================================================

  private async commitWork(): Promise<void> {
    // Process deletions first
    await this.commitDeletions(this.workInProgress!);

    // Run mount effects (useOnMount for function components)
    // Note: Class component onMount runs during render phase, not here
    // useOnMount runs AFTER first render, so state changes here can trigger recompile
    this.currentPhase = "mount";
    try {
      await this.runEffects(EffectPhase.Mount);
    } finally {
      this.currentPhase = "compile"; // Back to compile phase
    }

    // Run commit effects (useEffect)
    await this.runEffects(EffectPhase.Commit);
  }

  private async commitDeletions(fiber: FiberNode): Promise<void> {
    if (fiber.deletions) {
      for (const deletion of fiber.deletions) {
        await this.unmountFiber(deletion);
      }
      fiber.deletions = null;
    }

    let child = fiber.child;
    while (child) {
      await this.commitDeletions(child);
      child = child.sibling;
    }
  }

  // ============================================================================
  // Effects
  // ============================================================================

  private resetEffectQueues(): void {
    this.effectsByPhase.clear();
    this.afterCompileCallbacks = [];
  }

  private collectEffectsFromFiber(fiber: FiberNode): void {
    let hook = fiber.memoizedState;

    while (hook !== null) {
      if (hook.effect && hook.effect.pending) {
        const phase = hook.effect.phase;

        if (phase === EffectPhase.AfterCompile) {
          // Special handling for afterCompile
          if (typeof hook.memoizedState === "function") {
            this.afterCompileCallbacks.push(
              hook.memoizedState as (compiled: CompiledStructure) => void,
            );
          }
        } else {
          const effects = this.effectsByPhase.get(phase) ?? [];
          effects.push(hook.effect);
          this.effectsByPhase.set(phase, effects);
        }
      }

      hook = hook.next;
    }
  }

  private async runEffects(phase: EffectPhase): Promise<void> {
    const effects = this.effectsByPhase.get(phase) ?? [];

    for (const effect of effects) {
      if (!effect.pending) continue;

      try {
        // Run cleanup from previous render
        if (effect.destroy) {
          await effect.destroy();
        }

        // Run effect and capture cleanup
        const result = await effect.create();
        effect.destroy = typeof result === "function" ? result : null;
        effect.pending = false;
      } catch (error) {
        // Better error serialization for non-Error objects
        const errorDetails =
          error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { value: String(error), type: typeof error, raw: error };

        log.error(
          {
            error: errorDetails,
            phase,
            component: effect.debugLabel || "unknown",
          },
          "Effect error",
        );
        // Continue with other effects rather than crashing
      }
    }
  }

  // ============================================================================
  // Unmounting
  // ============================================================================

  private async unmountFiber(fiber: FiberNode): Promise<void> {
    // Depth-first: unmount children first
    let child = fiber.child;
    while (child) {
      await this.unmountFiber(child);
      child = child.sibling;
    }

    // Run unmount effects for function components
    let hook = fiber.memoizedState;
    while (hook !== null) {
      if (hook.effect?.destroy) {
        await hook.effect.destroy();
      }
      hook = hook.next;
    }

    // Class component cleanup
    if (fiber.stateNode) {
      this.cleanupComponentInfrastructure(fiber.stateNode);
      if (fiber.stateNode.onUnmount) {
        const wasInUnmount = this.currentPhase === "unmount";
        if (!wasInUnmount) {
          this.currentPhase = "unmount";
        }
        try {
          const wrapped = this.getWrappedMethod(fiber.stateNode, "onUnmount");
          await wrapped(this.com);
        } catch (error: unknown) {
          // Ignore abort errors during unmount
          if ((error as Error)?.name !== "AbortError") throw error;
        } finally {
          if (!wasInUnmount) {
            this.currentPhase = "idle";
          }
        }
      }
    }

    // Remove ref
    if (fiber.ref) {
      this.com._removeRef(fiber.ref);
    }
  }

  // ============================================================================
  // Component Infrastructure
  // ============================================================================

  private setupComponentInfrastructure(
    instance: ComponentInstance,
    props: Record<string, unknown>,
  ): void {
    // Use any for dynamic property access on class instances
    const inst = instance as unknown as Record<string, unknown>;
    inst.props = props;
    bindCOMSignals(instance, this.com);
    this.bindPropsSignals(instance, props);

    if (props.ref && typeof props.ref === "string") {
      this.com._setRef(props.ref, instance);
    }
  }

  private bindPropsSignals(instance: ComponentInstance, props: Record<string, unknown>): void {
    if (!props) return;

    const propsSignals = new Map<string, Signal<unknown>>();
    const inst = instance as unknown as Record<string, unknown>;
    inst._propsSignals = propsSignals;

    for (const key of Object.getOwnPropertyNames(inst)) {
      const value = inst[key];
      if (value && typeof value === "function") {
        const valueAny = value as unknown as Record<symbol, unknown>;
        if (valueAny[PROPS_SIGNAL_SYMBOL]) {
          const propKey = valueAny[PROPS_SIGNAL_SYMBOL];
          const jsxPropKey = propKey === true ? key : (propKey as string);

          if (typeof jsxPropKey === "string") {
            const propValue = props[jsxPropKey];
            if (propValue !== undefined) {
              (value as unknown as { set: (v: unknown) => void }).set(propValue);
            }
            propsSignals.set(jsxPropKey, value as Signal<unknown>);
          }
        }
      }
    }
  }

  private updatePropsSignals(instance: ComponentInstance, newProps: Record<string, unknown>): void {
    const inst = instance as unknown as Record<string, unknown>;
    const propsSignals = inst._propsSignals as Map<string, Signal<unknown>> | undefined;
    if (!propsSignals) return;

    for (const [key, signal] of propsSignals) {
      const newValue = newProps[key];
      if (newValue !== signal()) {
        signal.set(newValue !== undefined ? newValue : signal());
      }
    }
  }

  private cleanupComponentInfrastructure(instance: ComponentInstance): void {
    cleanupSignals(instance);

    const inst = instance as unknown as Record<string, unknown>;
    const propsSignals = inst._propsSignals as Map<string, unknown> | undefined;
    if (propsSignals) {
      propsSignals.clear();
      delete inst._propsSignals;
    }

    const props = inst.props as Record<string, unknown> | undefined;
    if (props?.ref && typeof props.ref === "string") {
      this.com._removeRef(props.ref);
    }
  }

  // ============================================================================
  // Tool Registration
  // ============================================================================

  /**
   * Register a static tool definition from a component class.
   * Converts flat tool format { name, description, input, run }
   * to ExecutableTool format { metadata: { name, description, input }, run }
   */
  private registerStaticTool(toolDef: any): void {
    if (!toolDef || (!toolDef.name && !toolDef.metadata?.name)) {
      log.warn("Static tool missing name, skipping registration");
      return;
    }

    if (toolDef.metadata) {
      this.com.addTool(toolDef);
    } else {
      // Convert flat format to ExecutableTool format
      const executableTool = {
        metadata: {
          name: toolDef.name,
          description: toolDef.description,
          input: toolDef.input, // Both ToolDefinition and metadata now use 'input'
        },
        run: toolDef.run,
      };

      this.com.addTool(executableTool);
    }
  }

  /**
   * Re-registers all ExecutableTool instances from the fiber tree.
   * This ensures tools match the current JSX tree each tick, supporting:
   * - Conditional tool rendering (tools can be added/removed dynamically)
   * - Module identity issues (onTickStart inheritance may not work)
   */
  private async reregisterToolsFromFibers(fiber: FiberNode | null): Promise<void> {
    if (!fiber) return;

    const instance = fiber.stateNode as any;
    const constructor = instance?.constructor as any;

    // Pattern 1: createTool() - static metadata and run on class
    const metadata = constructor?.metadata || instance?.metadata;
    const run = constructor?.run || instance?.run;

    if (metadata?.name && typeof run === "function") {
      this.com.addTool({ metadata, run });
    }

    // Pattern 2: Component with static tool property (e.g., static tool = todoListTool)
    const staticTool = constructor?.tool;
    if (staticTool?.metadata?.name && typeof staticTool?.run === "function") {
      this.com.addTool(staticTool);
    }

    // Pattern 3: Instance tool property
    const instanceTool = instance?.tool;
    if (
      instanceTool?.metadata?.name &&
      typeof instanceTool?.run === "function" &&
      instanceTool !== staticTool
    ) {
      this.com.addTool(instanceTool);
    }

    // Traverse children
    let child = fiber.child;
    while (child) {
      await this.reregisterToolsFromFibers(child);
      child = child.sibling;
    }
  }

  // ============================================================================
  // Component Lifecycle Middleware
  // ============================================================================

  /**
   * Wraps component lifecycle methods with middleware from the hook registry.
   * This enables observability, debugging, and extension of component behavior.
   */
  private wrapComponentMethods(instance: ComponentInstance): void {
    if (!this.hookRegistry) {
      return;
    }

    const componentClass = instance.constructor;
    const componentName = getComponentName(instance as EngineComponent, componentClass);
    const componentTags = getComponentTags(componentClass);

    // Summarize props for DevTools visibility (avoid large objects)
    const summarizeProps = (props: Record<string, unknown>): Record<string, string> => {
      const summary: Record<string, string> = {};
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined) continue;
        if (value === null) {
          summary[key] = "null";
        } else if (typeof value === "function") {
          summary[key] = "ƒ()";
        } else if (Array.isArray(value)) {
          summary[key] = `Array(${value.length})`;
        } else if (typeof value === "object") {
          const name = (value as any).constructor?.name;
          summary[key] = name && name !== "Object" ? `<${name}>` : "{...}";
        } else if (typeof value === "string" && value.length > 50) {
          summary[key] = `"${value.slice(0, 47)}..."`;
        } else {
          summary[key] = String(value);
        }
      }
      return summary;
    };

    const methodsToWrap: ComponentHookName[] = [
      "onMount",
      "onUnmount",
      "onStart",
      "onTickStart",
      "render",
      "onTickEnd",
      "onComplete",
      "onError",
      "onAfterCompile",
    ];

    for (const methodName of methodsToWrap) {
      if (typeof instance[methodName] === "function") {
        const originalMethod = instance[methodName].bind(instance);
        const middleware = this.hookRegistry.getMiddleware(
          methodName,
          componentClass,
          componentName,
          componentTags,
        );

        // Get props summary (captured at wrap time, will show initial props)
        const propsSummary = instance.props ? summarizeProps(instance.props) : undefined;

        // Create a Procedure for the component method with middleware applied
        // Include component name and props in metadata for DevTools visibility
        const procedure = createEngineProcedure(
          {
            name: `component:${methodName}`,
            metadata: {
              type: "component",
              component: componentName,
              hook: methodName,
              ...(propsSummary && Object.keys(propsSummary).length > 0
                ? { props: propsSummary }
                : {}),
            },
          },
          originalMethod as any,
        ).use(...(middleware as any[]));

        if (!this.wrappedMethods.has(instance)) {
          this.wrappedMethods.set(instance, new Map());
        }
        this.wrappedMethods.get(instance)!.set(methodName, procedure);
      }
    }
  }

  /**
   * Gets the wrapped version of a component method, or the original if no wrapper exists.
   */
  private getWrappedMethod(instance: ComponentInstance, methodName: ComponentHookName): Function {
    const wrapped = this.wrappedMethods.get(instance)?.get(methodName);
    if (wrapped) {
      return wrapped;
    }
    return instance[methodName]?.bind(instance) || (() => {});
  }

  // ============================================================================
  // Child Normalization
  // ============================================================================

  private normalizeChildren(children: unknown): NormalizedChild[] {
    if (children === null || children === undefined || children === false) {
      return [];
    }

    // Handle arrays - flatten but don't recurse into JSX element children
    if (Array.isArray(children)) {
      const result: NormalizedChild[] = [];
      for (const child of children) {
        if (child === null || child === undefined || child === false) {
          continue;
        }
        if (isElement(child)) {
          result.push({ kind: "element", element: child as JSX.Element });
        } else if (isContentBlock(child)) {
          result.push({ kind: "content-block", block: child });
        } else if (typeof child === "string") {
          result.push({ kind: "text", text: child });
        } else if (typeof child === "number") {
          result.push({ kind: "text", text: String(child) });
        } else if (Array.isArray(child)) {
          // Nested array - flatten it
          result.push(...this.normalizeChildren(child));
        }
        // Ignore other types
      }
      return result;
    }

    // Single child
    if (isElement(children)) {
      return [{ kind: "element", element: children as JSX.Element }];
    }

    if (isContentBlock(children)) {
      return [{ kind: "content-block", block: children }];
    }

    if (typeof children === "string") {
      return [{ kind: "text", text: children }];
    }

    if (typeof children === "number") {
      return [{ kind: "text", text: String(children) }];
    }

    return [];
  }

  // ============================================================================
  // Type Detection
  // ============================================================================

  private isClassComponent(type: unknown): type is ClassComponent {
    if (typeof type !== "function") return false;

    const proto = (type as new () => unknown).prototype;
    if (!proto) return false;

    // Check for Component base class or render method
    let current = proto;
    while (current && current !== Object.prototype) {
      if (current.constructor?.name === "Component" || typeof current.render === "function") {
        return true;
      }
      current = Object.getPrototypeOf(current);
    }

    return false;
  }

  /**
   * Check if a component type is a host primitive (Section, Entry, etc).
   * These should be handled like string host components, not called as functions.
   *
   * Note: Message is NOT a primitive - it's sugar that returns Entry when called.
   *
   * Uses three strategies for identification:
   * 1. Symbol-based (minification-safe) - functions marked with HOST_PRIMITIVE_SYMBOL
   * 2. Reference-based - direct equality check (same module)
   * 3. Name-based (fallback) - for cross-module compatibility in dev
   */
  private isHostPrimitive(type: unknown): boolean {
    if (typeof type !== "function") return false;

    // Strategy 1: Symbol-based (minification-safe)
    if (isHostPrimitiveSymbol(type)) {
      return true;
    }

    // Strategy 2 & 3: Reference or name-based (for backwards compatibility)
    const hostPrimitives = [
      { ref: Section, name: "Section" },
      { ref: Entry, name: "Entry" },
      { ref: Timeline, name: "Timeline" },
      { ref: Tool, name: "Tool" },
      { ref: Ephemeral, name: "Ephemeral" },
      { ref: Text, name: "Text" },
      { ref: Image, name: "Image" },
      { ref: Code, name: "Code" },
      { ref: Json, name: "Json" },
      { ref: Document, name: "Document" },
      { ref: Audio, name: "Audio" },
      { ref: Video, name: "Video" },
      { ref: Renderer, name: "Renderer" },
    ];

    return hostPrimitives.some(
      (p) => type === p.ref || (type as { name?: string }).name === p.name,
    );
  }

  /**
   * Check if a fiber type matches a component function or name.
   * Handles cross-module identity issues by also checking name.
   */
  private isType(type: ComponentType, component: unknown, name: string): boolean {
    return (
      type === component ||
      (typeof type === "function" && type.name === name) ||
      (typeof type === "object" && type !== null && (type as { name?: string }).name === name)
    );
  }

  // ============================================================================
  // Work Scheduling
  // ============================================================================

  private scheduleWork(fiber: FiberNode): void {
    if (this.isRendering) {
      this.pendingWork.push(fiber);
    } else {
      this.com.requestRecompile("fiber state update");
    }
  }

  // ============================================================================
  // Content Block Mapping
  // ============================================================================

  private registerContentBlock(
    type: unknown,
    mapper: ContentBlockMapper,
    stringType?: string,
  ): void {
    this.contentBlockMappers.set(type, mapper);
    const typeName =
      stringType ||
      (typeof type === "function"
        ? (type as { name?: string }).name?.toLowerCase()
        : String(type).toLowerCase());
    if (typeName) {
      this.contentBlockMappers.set(typeName, mapper);
    }
  }

  private initializeContentBlockMappers(): void {
    initializeContentBlockMappers((type, mapper, stringType) =>
      this.registerContentBlock(type, mapper, stringType),
    );
  }

  // ============================================================================
  // Structure Collection
  // ============================================================================

  private collectStructures(fiber: FiberNode | null): CompiledStructure {
    const collected: CompiledStructure = {
      sections: new Map(),
      timelineEntries: [],
      systemMessageItems: [],
      tools: [],
      ephemeral: [],
      metadata: {},
    };

    if (!fiber) return collected;

    this.traverseAndCollect(fiber, collected, { value: 0 }, false, []);
    return collected;
  }

  private traverseAndCollect(
    fiber: FiberNode,
    collected: CompiledStructure,
    orderIndex: { value: number },
    inSectionOrMessage: boolean,
    rendererStack: ContentRenderer[],
  ): void {
    const currentRenderer =
      rendererStack.length > 0 ? rendererStack[rendererStack.length - 1] : this.defaultRenderer;

    const type = fiber.type;
    const props = fiber.props;

    // Renderer component
    if (this.isType(type, Renderer, "Renderer")) {
      const renderer = props.instance as ContentRenderer;
      if (renderer) {
        rendererStack.push(renderer);
        this.traverseChildren(fiber, collected, orderIndex, inSectionOrMessage, rendererStack);
        rendererStack.pop();
      }
      return;
    }

    // Section
    if (this.isType(type, Section, "Section")) {
      // Collect content from reconciled children, or fall back to props.content
      let content: unknown;

      if (fiber.child) {
        // Collect from reconciled children (components have been rendered)
        content = this.collectContentFromFiber(fiber, currentRenderer);
      } else if (props.content !== undefined) {
        // Direct content prop (e.g., <Section content="text" />)
        content = props.content;
      } else {
        content = [];
      }

      const section: CompiledSection = {
        id: (props.id as string) || `section-${Date.now()}`,
        content,
        visibility: props.visibility as CompiledSection["visibility"],
        audience: props.audience as CompiledSection["audience"],
        title: props.title as string | undefined,
        tags: props.tags as string[] | undefined,
        metadata: props.metadata as Record<string, unknown> | undefined,
        renderer: currentRenderer,
      };

      const existing = collected.sections.get(section.id);
      if (!existing) {
        collected.sections.set(section.id, section);
        collected.systemMessageItems.push({
          type: "section",
          sectionId: section.id,
          index: orderIndex.value++,
          renderer: currentRenderer,
        });
      } else {
        // Merge
        const merged = this.mergeSections(existing, section);
        collected.sections.set(section.id, merged);
      }

      this.traverseChildren(fiber, collected, orderIndex, true, rendererStack);
      return;
    }

    // Entry (core primitive - Message is sugar that returns Entry)
    // When Message is called as a function, it returns createElement(Entry, ...)
    if (this.isType(type, Entry, "Entry")) {
      // Collect content from reconciled children, or fall back to props.content or props.message.content
      let content: SemanticContentBlock[];

      if (fiber.child) {
        // Collect from reconciled children (components have been rendered)
        content = this.collectContentFromFiber(fiber, currentRenderer);
      } else {
        // No children - check for content in props
        const messageProps = props.message as Record<string, unknown> | undefined;
        const messageContent = messageProps?.content; // Message component puts content here
        const directContent = props.content; // Or might be passed directly
        const sourceContent = messageContent ?? directContent;

        if (sourceContent !== undefined) {
          // Normalize to ContentBlock array
          if (typeof sourceContent === "string") {
            content = [{ type: "text", text: sourceContent }];
          } else if (Array.isArray(sourceContent)) {
            content = sourceContent;
          } else {
            content = [];
          }
        } else {
          content = [];
        }
      }

      // message entry
      if (props.kind === "message") {
        const messageProps = props.message as Record<string, unknown> | undefined;
        const role = messageProps?.role as CompiledTimelineEntry["message"] extends {
          role: infer R;
        }
          ? R
          : string;

        if (role === "system") {
          collected.systemMessageItems.push({
            type: "message",
            content,
            index: orderIndex.value++,
            renderer: currentRenderer,
          });
        } else {
          const entry: CompiledTimelineEntry = {
            kind: "message",
            message: {
              role: (role || "user") as CompiledTimelineEntry["message"] extends {
                role: infer R;
              }
                ? R
                : never,
              content,
            },
            tags: props.tags as string[] | undefined,
            visibility: props.visibility as CompiledTimelineEntry["visibility"],
            metadata: messageProps?.metadata as Record<string, unknown> | undefined,
            renderer: currentRenderer !== this.defaultRenderer ? currentRenderer : undefined,
          };
          collected.timelineEntries.push(entry);
        }
      }

      this.traverseChildren(fiber, collected, orderIndex, true, rendererStack);
      return;
    }

    // Ephemeral
    if (this.isType(type, Ephemeral, "Ephemeral")) {
      // Collect content from reconciled children, or fall back to props.content
      let content: SemanticContentBlock[];

      if (fiber.child) {
        content = this.collectContentFromFiber(fiber, currentRenderer);
      } else if (props.content !== undefined) {
        // Direct content prop
        if (typeof props.content === "string") {
          content = [{ type: "text", text: props.content }];
        } else if (Array.isArray(props.content)) {
          content = props.content;
        } else {
          content = [];
        }
      } else {
        content = [];
      }

      collected.ephemeral.push({
        content,
        type: props.type as string | undefined,
        position: (props.position as "start" | "end") || "end",
        order: (props.order as number) ?? 0,
        id: props.id as string | undefined,
        tags: props.tags as string[] | undefined,
        metadata: props.metadata as Record<string, unknown> | undefined,
        renderer: currentRenderer,
      });
      return;
    }

    // Tool
    if (this.isType(type, Tool, "Tool")) {
      if (props.definition) {
        const toolDef =
          typeof props.definition === "string"
            ? this.com.getTool(props.definition)
            : props.definition;

        if (toolDef) {
          const toolAny = toolDef as Record<string, unknown>;
          if (toolAny.metadata) {
            const metadata = toolAny.metadata as Record<string, unknown>;
            const name = metadata.name as string;
            if (name) {
              const existingIndex = collected.tools.findIndex((t) => t.name === name);
              const toolEntry = {
                name,
                tool: toolDef as CompiledStructure["tools"][number]["tool"],
              };
              if (existingIndex >= 0) {
                collected.tools[existingIndex] = toolEntry;
              } else {
                collected.tools.push(toolEntry);
              }
            }
          }
        }
      }
    }

    // Content blocks at root level
    if (!inSectionOrMessage && this.isContentType(type)) {
      const blocks = this.collectContentFromFiber(fiber, currentRenderer);
      if (blocks.length > 0) {
        collected.systemMessageItems.push({
          type: "loose",
          content: blocks,
          index: orderIndex.value++,
          renderer: currentRenderer,
        });
      }
    }

    // Recurse
    this.traverseChildren(fiber, collected, orderIndex, inSectionOrMessage, rendererStack);
  }

  private traverseChildren(
    fiber: FiberNode,
    collected: CompiledStructure,
    orderIndex: { value: number },
    inSectionOrMessage: boolean,
    rendererStack: ContentRenderer[],
  ): void {
    let child = fiber.child;
    while (child) {
      this.traverseAndCollect(child, collected, orderIndex, inSectionOrMessage, rendererStack);
      child = child.sibling;
    }
  }

  private isContentType(type: unknown): boolean {
    return (
      type === Text ||
      type === Code ||
      type === Image ||
      type === Json ||
      type === Document ||
      type === Audio ||
      type === Video ||
      type === "text" ||
      type === "code" ||
      type === "image" ||
      type === "json" ||
      type === "document" ||
      type === "audio" ||
      type === "video"
    );
  }

  private collectContentFromFiber(
    fiber: FiberNode,
    renderer?: ContentRenderer,
  ): SemanticContentBlock[] {
    const blocks: SemanticContentBlock[] = [];

    let child = fiber.child;
    while (child) {
      this.collectContentFromChild(child, blocks, renderer);
      child = child.sibling;
    }

    return blocks;
  }

  private collectContentFromChild(
    fiber: FiberNode,
    blocks: SemanticContentBlock[],
    renderer?: ContentRenderer,
  ): void {
    const type = fiber.type;
    const props = fiber.props;

    // Content block fiber
    if (type === "content-block") {
      blocks.push(props.block as SemanticContentBlock);
      return;
    }

    // Text fiber
    if (type === "text") {
      blocks.push({ type: "text", text: props.value as string });
      return;
    }

    // Use content block mapper
    const mapper = this.contentBlockMappers.get(type);
    if (mapper) {
      const element = { type, props, key: fiber.key } as JSX.Element;
      const block = mapper(element, renderer);
      if (block) {
        blocks.push(block);
        return;
      }
    }

    // Renderer component - switch renderer for children
    if (this.isType(type, Renderer, "Renderer")) {
      const newRenderer = props.instance as ContentRenderer;
      if (newRenderer) {
        // Collect content from children with the new renderer
        let child = fiber.child;
        while (child) {
          this.collectContentFromChild(child, blocks, newRenderer);
          child = child.sibling;
        }
      }
      return;
    }

    // Custom element - extract semantic
    if (typeof type === "string") {
      const semanticNode = extractSemanticNodeFromElement({
        type,
        props,
      } as JSX.Element);
      blocks.push({
        type: "text",
        text: "",
        semanticNode,
        semantic: {
          type: "custom",
          rendererTag: type,
          rendererAttrs: props || {},
        },
      } as SemanticContentBlock);
      return;
    }

    // Recurse into children
    let child = fiber.child;
    while (child) {
      this.collectContentFromChild(child, blocks, renderer);
      child = child.sibling;
    }
  }

  private mergeSections(existing: CompiledSection, incoming: CompiledSection): CompiledSection {
    let combinedContent: unknown;

    if (typeof existing.content === "string" && typeof incoming.content === "string") {
      combinedContent = `${existing.content}\n${incoming.content}`;
    } else if (Array.isArray(existing.content) && Array.isArray(incoming.content)) {
      combinedContent = [...existing.content, ...incoming.content];
    } else {
      combinedContent = [existing.content, incoming.content];
    }

    return {
      id: incoming.id,
      content: combinedContent,
      title: incoming.title || existing.title,
      tags: incoming.tags || existing.tags,
      visibility: incoming.visibility || existing.visibility,
      audience: incoming.audience || existing.audience,
      metadata: incoming.metadata || existing.metadata,
      renderer: incoming.renderer,
    };
  }
}
