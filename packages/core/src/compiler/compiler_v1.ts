import { Logger } from 'aidk-kernel';
import { ContextObjectModel } from '../com/object-model';
import { bindCOMSignals, cleanupSignals, PROPS_SIGNAL_SYMBOL } from '../state/use-state';
import { signal, type Signal } from '../state/use-state';
import { type COMInput } from '../com/types';
import { type JSX, isElement, Fragment, createElement } from '../jsx/jsx-runtime';
import { Component, type EngineComponent, type TickState, type PureFunctionComponent, type RecoveryAction, type AfterCompileContext, type ComponentLifecycleHooks } from '../component/component';
import { Timeline, Section, Message, Tool, Entry, Ephemeral } from '../jsx/components/primitives';
import { Text, Image, Document, Audio, Video, Code, Json } from '../jsx/components/content';
import { H1, H2, H3, Header, Paragraph, List, ListItem, Table, Row, Column } from '../jsx/components/semantic';
import { Renderer } from '../jsx/components/renderer';
import { ComponentHookRegistry, type ComponentHookName, getComponentTags, getComponentName } from '../component/component-hooks';
import { type ContentBlock } from 'aidk-shared';
import { ContentRenderer, type SemanticContentBlock, MarkdownRenderer } from '../renderers';
import { createEngineProcedure, applyRegistryMiddleware } from '../procedure';
import { type CompiledStructure, type CompiledSection, type CompiledTimelineEntry, type SystemMessageItem, type Fiber, isFragment, type CompileStabilizationOptions, type CompileStabilizationResult } from './types';
import { initializeContentBlockMappers, type ContentBlockMapper } from './content-block-registry';
import { extractSemanticNodeFromElement, extractTextFromElement } from './extractors';

const log = Logger.for('FiberCompiler');

/**
 * FiberCompiler: Converts JSX → CompiledStructure
 * 
 * Responsibilities:
 * - Reconciliation (JSX → Fiber tree)
 * - Collection (Fiber tree → CompiledStructure)
 * - Component instance management
 * 
 * Does NOT handle:
 * - Formatting (that's StructureRenderer's job)
 * - Application to COM (that's StructureRenderer's job)
 */

export class FiberCompiler {
  private rootFiber: Fiber | null = null;
  private hookRegistry?: ComponentHookRegistry;
  private wrappedMethods = new WeakMap<any, Map<string, Function>>();
  private defaultRenderer: ContentRenderer = new MarkdownRenderer();
  private contentBlockMappers = new Map<any, ContentBlockMapper>();

  constructor(private com: ContextObjectModel, hookRegistry?: ComponentHookRegistry) {
    this.hookRegistry = hookRegistry;
    this.initializeContentBlockMappers();
  }

  /**
   * Helper to register a content block mapper for both function reference and string type.
   * @param type The JSX component type (function reference) or string type name
   * @param mapper The mapper function
   * @param stringType Optional string type name (defaults to function name lowercase)
   */
  private registerContentBlock(type: any, mapper: ContentBlockMapper, stringType?: string): void {
    this.contentBlockMappers.set(type, mapper);
    const typeName = stringType || (typeof type === 'function' ? type.name?.toLowerCase() : String(type).toLowerCase());
    if (typeName) {
      this.contentBlockMappers.set(typeName, mapper);
    }
  }

  /**
   * Initialize the content block mapper registry.
   * Delegates to the extracted registration function.
   */
  private initializeContentBlockMappers(): void {
    initializeContentBlockMappers((type, mapper, stringType) =>
      this.registerContentBlock(type, mapper, stringType)
    );
  }

  /**
   * Compiles JSX Element into CompiledStructure.
   * Persists component instances across compilations.
   */
  async compile(element: JSX.Element, state?: TickState): Promise<CompiledStructure> {
    this.rootFiber = await this.reconcile(this.rootFiber, element, state);
    return this.collectStructures(this.rootFiber);
  }

  /**
   * Collects all structures from the fiber tree.
   * This is the declarative phase - we're just reading what components declared.
   */
  private collectStructures(fiber: Fiber | null): CompiledStructure {
    const collected: CompiledStructure = {
      sections: new Map(),
      timelineEntries: [],
      systemMessageItems: [],
      tools: [],
      ephemeral: [],
      metadata: {}
    };

    if (!fiber) return collected;

    // Track renderer stack (closest renderer wins)
    const rendererStack: ContentRenderer[] = [];
    this.traverseAndCollect(fiber, collected, { value: 0 }, false, rendererStack);
    return collected;
  }


  /**
   * Collects ContentBlock[] from Message children.
   * Supports both ContentBlock objects and Content component JSX elements.
   * Also handles semantic primitives (H1, H2, List, etc.) and converts them to SemanticContentBlock.
   * Children take precedence over content prop.
   */
  private collectContentBlocks(fiber: Fiber): SemanticContentBlock[] {
    const blocks: ContentBlock[] = [];
    const rawChildren = fiber.props.children;

    let children: any[] = [];
    if (rawChildren === undefined || rawChildren === null) {
      children = [];
    } else if (Array.isArray(rawChildren)) {
      children = rawChildren.flat();
    } else {
      children = [rawChildren];
    }

    for (const child of children) {
      log.info({ child }, 'collectContentBlocks');
      // Handle ContentBlock objects (already converted)
      if (child && typeof child === 'object' && 'type' in child && !isElement(child)) {
        const blockTypes = ['text', 'image', 'document', 'audio', 'video', 'code', 'json', 'tool_use', 'tool_result', 'reasoning', 'user_action', 'system_event', 'state_change'];
        if (blockTypes.includes(child.type)) {
          blocks.push(child as SemanticContentBlock);
          continue;
        }
      }

      // Handle JSX elements - use registry
      if (isElement(child)) {
        const mapper = this.contentBlockMappers.get(child.type);
        if (mapper) {
          const block = mapper(child);
          if (block) {
            blocks.push(block);
            continue;
          }
        }
        
        // Fallback for unknown/custom elements
        // Support custom XML tags by extracting semantic tree
        if (child.type && typeof child.type === 'string') {
          const semanticNode = extractSemanticNodeFromElement(child);
          blocks.push({
            type: 'text',
            text: '',
            semanticNode,
            semantic: { 
              type: 'custom',
              rendererTag: child.type,
              rendererAttrs: child.props || {}
            }
          } as SemanticContentBlock);
          continue;
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        // Already a ContentBlock object
        blocks.push(child as SemanticContentBlock);
      } else if (typeof child === 'string') {
        // Plain string becomes text block
        blocks.push({ type: 'text', text: child } as SemanticContentBlock);
      }
    }

    return blocks as SemanticContentBlock[];
  }

  /**
   * Collects content blocks from a mix of fiber children (for rendered components)
   * and raw ContentBlocks from props.children (which are filtered out by normalizeChildren).
   * 
   * This handles the case where Message children contain both:
   * - JSX elements (like <Text>, <MyComponent>) that need fiber processing
   * - Raw ContentBlock objects (like { type: 'text', text: '...' }) that pass through
   */
  private collectContentBlocksMixed(fiber: Fiber): SemanticContentBlock[] {
    const blocks: SemanticContentBlock[] = [];
    const rawChildren = fiber.props.children;
    
    let children: any[] = [];
    if (rawChildren === undefined || rawChildren === null) {
      children = [];
    } else if (Array.isArray(rawChildren)) {
      children = rawChildren.flat();
    } else {
      children = [rawChildren];
    }
    
    // Build a map of fiber children by key/index for matching
    const fiberMap = new Map<string | number, Fiber>();
    if (fiber.children) {
      fiber.children.forEach((f, i) => {
        const key = f.key ?? i;
        fiberMap.set(key, f);
      });
    }
    
    let fiberIndex = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      
      // Handle raw ContentBlock objects (not JSX elements)
      if (child && typeof child === 'object' && 'type' in child && !isElement(child)) {
        const blockTypes = ['text', 'image', 'document', 'audio', 'video', 'code', 'json', 'tool_use', 'tool_result', 'reasoning', 'user_action', 'system_event', 'state_change'];
        if (blockTypes.includes(child.type)) {
          blocks.push(child as SemanticContentBlock);
          continue;
        }
      }
      
      // Handle JSX elements - try to find matching fiber first (for rendered components)
      if (isElement(child)) {
        const key = child.key ?? fiberIndex;
        const matchingFiber = fiberMap.get(key);
        
        if (matchingFiber) {
          // Use fiber-based collection for this element (handles rendered components)
          const fiberBlocks = this.collectContentBlocksFromFibers([matchingFiber]);
          blocks.push(...fiberBlocks);
          fiberIndex++;
          continue;
        }
        
        // Fallback: use registry mapper directly on the JSX element
        const mapper = this.contentBlockMappers.get(child.type);
        if (mapper) {
          const block = mapper(child);
          if (block) {
            blocks.push(block);
            fiberIndex++;
            continue;
          }
        }
        
        // Fallback for unknown/custom elements - extract semantic tree
        if (child.type && typeof child.type === 'string') {
          const semanticNode = extractSemanticNodeFromElement(child);
          blocks.push({
            type: 'text',
            text: '',
            semanticNode,
            semantic: { 
              type: 'custom',
              rendererTag: child.type,
              rendererAttrs: child.props || {}
            }
          } as SemanticContentBlock);
        }
        fiberIndex++;
      } else if (typeof child === 'string') {
        // Plain string becomes text block
        blocks.push({ type: 'text', text: child } as SemanticContentBlock);
      }
    }
    
    return blocks;
  }

  /**
   * Collect content blocks from reconciled fiber children.
   * Unlike collectContentBlocks, this operates on the fiber tree (after component render).
   */
  private collectContentBlocksFromFibers(fibers: Fiber[], currentRenderer?: ContentRenderer): SemanticContentBlock[] {
    const blocks: SemanticContentBlock[] = [];
    
    for (const fiber of fibers) {
      // Check for wrapper components (function components that return <Renderer>)
      // This handles cases like <Section><XML><p>...</p></XML></Section>
      if (typeof fiber.type === 'function') {
        try {
          const rendered = fiber.type(fiber.props);
          // Check if it returned a Renderer component
          if (rendered && typeof rendered === 'object' && 'props' in rendered && rendered.props?.instance) {
            const wrapperRenderer = rendered.props.instance as ContentRenderer;
            // Use wrapper renderer for children, falling back to currentRenderer
            const effectiveRenderer = wrapperRenderer || currentRenderer;
            
            // Process children with the wrapper's renderer
            const children = rendered.props?.children !== undefined 
              ? (Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children])
              : fiber.children;
            
            // Recursively collect from children with the wrapper renderer
            const childFibers = children.map((child: any): Fiber => {
              if (typeof child === 'object' && 'type' in child) {
                return child as Fiber;
              }
              return { type: Fragment, props: { children: child }, children: [], key: null };
            });
            blocks.push(...this.collectContentBlocksFromFibers(childFibers, effectiveRenderer));
            continue;
          }
        } catch (e) {
          // Component might require runtime context, skip wrapper detection
          // Fall through to normal processing
        }
      }
      
      // Check if this fiber's type is a registered content block
      const mapper = this.contentBlockMappers.get(fiber.type);
      if (mapper) {
        // Create a JSX-like element from the fiber for the mapper
        const element = { type: fiber.type, props: fiber.props, key: fiber.key } as JSX.Element;
        const block = mapper(element, currentRenderer);
        if (block) {
          blocks.push(block);
          continue;
        }
      }
      
      // Check for already-converted ContentBlock objects in props
      if (fiber.props && typeof fiber.props === 'object' && 'type' in fiber.props) {
        const blockTypes = ['text', 'image', 'document', 'audio', 'video', 'code', 'json', 'tool_use', 'tool_result', 'reasoning'];
        if (blockTypes.includes(fiber.props.type)) {
          blocks.push(fiber.props as SemanticContentBlock);
          continue;
        }
      }
      
      // Recurse into children (handles Fragment, nested components, etc.)
      if (fiber.children && fiber.children.length > 0) {
        blocks.push(...this.collectContentBlocksFromFibers(fiber.children, currentRenderer));
      }
    }
    
    return blocks;
  }

  /**
   * Traverses the fiber tree and collects structures.
   * Preserves render order for all content.
   * Tracks renderer stack for context-aware formatting.
   */
  private traverseAndCollect(
    fiber: Fiber, 
    collected: CompiledStructure, 
    orderIndex: { value: number } = { value: 0 }, 
    inSectionOrMessage: boolean = false,
    rendererStack: ContentRenderer[] = []
  ) {
    const currentRenderer = rendererStack.length > 0 ? rendererStack[rendererStack.length - 1] : this.defaultRenderer;
    
    // Generic Renderer component - applies any ContentRenderer to children
    // Also handles wrapper components like <XML>, <Markdown> that return <Renderer>
    if (fiber.type === Renderer || fiber.type?.name === 'Renderer') {
      const renderer = fiber.props.instance as ContentRenderer;
      if (renderer) {
        rendererStack.push(renderer);
        
        for (const child of fiber.children) {
          this.traverseAndCollect(child, collected, orderIndex, inSectionOrMessage, rendererStack);
        }
        
        rendererStack.pop();
      }
      return;
    }
    
    // Check for wrapper components (function components that return <Renderer>)
    if (typeof fiber.type === 'function') {
      try {
        const rendered = fiber.type(fiber.props);
        // Check if it returned a Renderer component
        if (rendered && typeof rendered === 'object' && 'props' in rendered && rendered.props?.instance) {
          const renderer = rendered.props.instance as ContentRenderer;
          if (renderer) {
            rendererStack.push(renderer);
            
            // Process children from the rendered element or original fiber
            const children = rendered.props?.children !== undefined 
              ? (Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children])
              : fiber.children;
            
            for (const child of children) {
              // Convert child to fiber-like structure if needed
              const childFiber: Fiber = typeof child === 'object' && 'type' in child 
                ? child as Fiber 
                : { type: Fragment, props: { children: child }, children: [], key: null };
              this.traverseAndCollect(childFiber, collected, orderIndex, inSectionOrMessage, rendererStack);
            }
            
            rendererStack.pop();
          }
          return;
        }
      } catch (e) {
        // Component might require runtime context, skip wrapper detection
        // Fall through to normal processing
      }
    }
    
    if (fiber.type === Timeline || fiber.type?.name === 'Timeline') {
      // Timeline wrapper - just recurse to children
    } else if (fiber.type === Section || fiber.type?.name === 'Section') {
      let content: unknown;
      
      if (fiber.children && fiber.children.length > 0) {
        // Collect from RECONCILED children (components have been rendered)
        // Pass currentRenderer so it can be attached to semanticNode roots
        content = this.collectContentBlocksFromFibers(fiber.children, currentRenderer !== this.defaultRenderer ? currentRenderer : undefined);
      } else if (fiber.props.children !== undefined && fiber.props.children !== null) {
        // Fallback to raw props.children for simple cases (no components)
        content = this.collectContentBlocks(fiber);
      } else if (fiber.props.content !== undefined) {
        content = fiber.props.content;
      } else {
        content = [];
      }
      
      const section: CompiledSection = {
        id: fiber.props.id || `section-${Date.now()}`,
        content,
        visibility: fiber.props.visibility,
        audience: fiber.props.audience,
        title: fiber.props.title,
        tags: fiber.props.tags,
        metadata: fiber.props.metadata,
        renderer: currentRenderer
      };

      const existing = collected.sections.get(section.id);
      const isFirstOccurrence = !existing;
      
      if (!existing) {
        collected.sections.set(section.id, section);
      } else {
        let combinedContent: unknown;
        if (typeof existing.content === 'string' && typeof section.content === 'string') {
          combinedContent = `${existing.content}\n${section.content}`;
        } else if (Array.isArray(existing.content) && Array.isArray(section.content)) {
          combinedContent = [...existing.content, ...section.content];
        } else if (typeof existing.content === 'object' && typeof section.content === 'object' && 
                   existing.content !== null && section.content !== null &&
                   !Array.isArray(existing.content) && !Array.isArray(section.content)) {
          combinedContent = { ...existing.content, ...section.content };
        } else {
          combinedContent = [existing.content, section.content];
        }
        
        const mergedSection: CompiledSection = {
          id: section.id,
          content: combinedContent,
          title: section.title || existing.title,
          tags: section.tags || existing.tags,
          visibility: section.visibility || existing.visibility,
          audience: section.audience || existing.audience,
          metadata: section.metadata || existing.metadata,
          renderer: currentRenderer
        };
        
        collected.sections.set(section.id, mergedSection);
      }
      
      // Only add to systemMessageItems if this is the first occurrence of this section
      // Otherwise we'd duplicate the section content in the consolidated system message
      if (isFirstOccurrence) {
        collected.systemMessageItems.push({ 
          type: 'section', 
          sectionId: section.id, 
          index: orderIndex.value++,
          renderer: currentRenderer
        });
      }
      
      for (const child of fiber.children) {
        this.traverseAndCollect(child, collected, orderIndex, true, rendererStack);
      }
      return;
    } else if (fiber.type === Ephemeral || fiber.type?.name === 'Ephemeral') {
      // Ephemeral content - NOT a message, added to com.ephemeral
      let content: SemanticContentBlock[];
      
      if (fiber.props.children !== undefined && fiber.props.children !== null) {
        content = this.collectContentBlocks(fiber);
      } else if (fiber.props.content !== undefined) {
        content = typeof fiber.props.content === 'string' 
          ? [{ type: 'text', text: fiber.props.content }]
          : fiber.props.content;
      } else {
        content = [];
      }
      
      collected.ephemeral.push({
        content,
        type: fiber.props.type,
        position: fiber.props.position || 'end',
        order: fiber.props.order ?? 0,
        id: fiber.props.id,
        tags: fiber.props.tags,
        metadata: fiber.props.metadata,
        renderer: currentRenderer,
      });
      
      return;
    } else if ((fiber.type === Entry || fiber.type?.name === 'Entry') && fiber.props.kind === 'message') {
      // Only collect Entry with kind='message' - Message is a wrapper that returns Entry,
      // so we'd get duplicates if we also matched Message by name
      let content: SemanticContentBlock[];

      if (fiber.props.children !== undefined && fiber.props.children !== null) {
        // Collect from props.children - handles both JSX elements and raw ContentBlocks
        // This is important because normalizeChildren filters out non-JSX items,
        // so raw ContentBlocks from component render output aren't in fiber.children
        // 
        // For class components inside Message children, we need to collect from
        // fiber.children to get the rendered output. But we also need raw ContentBlocks
        // from props.children. So we merge both sources.
        content = this.collectContentBlocksMixed(fiber);
      } else if (fiber.props.message?.content !== undefined) {
        // Entry stores content inside props.message.content
        content = Array.isArray(fiber.props.message.content)
          ? fiber.props.message.content as SemanticContentBlock[]
          : typeof fiber.props.message.content === 'string'
            ? [{ type: 'text', text: fiber.props.message.content } as SemanticContentBlock]
            : [];
      } else {
        content = [];
      }

      const role = fiber.props.message?.role;
      
      if (role === 'system') {
        collected.systemMessageItems.push({ 
          type: 'message', 
          content,
          index: orderIndex.value++,
          renderer: currentRenderer
        });
      } else {
        const entry: CompiledTimelineEntry = {
          kind: 'message',
          message: {
            role: role || 'user',
            content
          },
          tags: fiber.props.tags,
          visibility: fiber.props.visibility,
          metadata: fiber.props.message?.metadata,
          renderer: currentRenderer !== this.defaultRenderer ? currentRenderer : undefined
        };
        collected.timelineEntries.push(entry);
      }
      
      for (const child of fiber.children) {
        this.traverseAndCollect(child, collected, orderIndex, true, rendererStack);
      }
      return;
    } else if (fiber.type === Tool || fiber.type?.name === 'Tool') {
      if (fiber.props.definition) {
        const tool = typeof fiber.props.definition === 'string'
          ? this.com.getTool(fiber.props.definition)
          : fiber.props.definition;

        if (tool && tool.metadata?.name) {
          const existingIndex = collected.tools.findIndex(t => t.name === tool.metadata.name);
          if (existingIndex >= 0) {
            collected.tools[existingIndex] = { name: tool.metadata.name, tool };
          } else {
            collected.tools.push({ name: tool.metadata.name, tool });
          }
        }
      }
    } else if (!inSectionOrMessage && (fiber.type === Text || fiber.type === Code || fiber.type === Image || 
               fiber.type === Json || fiber.type === Document || fiber.type === Audio || fiber.type === Video ||
               fiber.type === 'text' || fiber.type === 'code' || fiber.type === 'image' ||
               fiber.type === 'json' || fiber.type === 'document' || fiber.type === 'audio' || fiber.type === 'video')) {
      const blocks = this.collectContentBlocks({ ...fiber, props: { ...fiber.props, children: fiber } });
      if (blocks.length > 0) {
        collected.systemMessageItems.push({ 
          type: 'loose', 
          content: blocks,
          index: orderIndex.value++,
          renderer: currentRenderer
        });
      }
    }

    for (const child of fiber.children) {
      this.traverseAndCollect(child, collected, orderIndex, inSectionOrMessage, rendererStack);
    }
  }

  private async reconcileChildren(oldFiber: Fiber | null, newChildren: JSX.Element[], state?: TickState): Promise<Fiber[]> {
    const oldChildren = oldFiber && oldFiber.children ? oldFiber.children : [];

    const reconciledPromises = newChildren.map(async (child, i) => {
      const oldChild = oldChildren[i] || null;
      return await this.reconcile(oldChild, child, state);
    });
    const reconciledChildren = (await Promise.all(reconciledPromises)).filter(c => c !== null) as Fiber[];

    if (oldChildren.length > newChildren.length) {
      for (let i = newChildren.length; i < oldChildren.length; i++) {
        this.unmountFiber(oldChildren[i]);
      }
    }

    return reconciledChildren;
  }

  private async reconcile(oldFiber: Fiber | null, element: JSX.Element | null, state?: TickState): Promise<Fiber | null> {
    if (!element) {
      if (oldFiber) {
        this.unmountFiber(oldFiber);
      }
      return null;
    }

    const type = element.type;
    const props = element.props || {};
    const childrenElements = this.normalizeChildren(props.children);

    let instance = oldFiber?.instance;
    let children: Fiber[] = [];
    const isDirectInstance = typeof type === 'object' && type !== null;

    if (oldFiber && oldFiber.type === type) {
      // Component already exists - update props signals if props changed
      if (instance) {
        // Update input() signals with new prop values
        this.updatePropsSignals(instance, props);
        
        // Merge new JSX props into existing props, preserving constructor-set values
        // when JSX provides empty props (e.g., <TodoListTool /> with no attributes)
        if (instance.props) {
          if (Object.keys(props).length > 0) {
            instance.props = { ...instance.props, ...props };
          }
          // If props is empty, preserve existing instance.props unchanged
        } else {
          instance.props = props;
        }
      }
    } else {
      if (oldFiber) {
        this.unmountFiber(oldFiber);
      }

      if (this.isClassComponent(type)) {
        instance = new type(props);
        this.wrapComponentMethods(instance);
        
        // Register static tool if present on the class
        if ((type as any).tool) {
          this.registerStaticTool((type as any).tool);
        }
        
        // Handle infrastructure automatically (signals, refs, props) before calling onMount
        this.setupComponentInfrastructure(instance, props);
        
        if (instance.onMount) {
          const wrapped = this.getWrappedMethod(instance, 'onMount');
          await wrapped(this.com);
        }

        // if (instance.onTickStart) {
        //   const wrapped = this.getWrappedMethod(instance, 'onTickStart');
        //   await wrapped(this.com, state || {});
        // }
      } else if (isDirectInstance) {
        instance = type;
        this.wrapComponentMethods(instance);
        
        // Register static tool if present on the instance's constructor
        if (instance.constructor?.tool) {
          this.registerStaticTool(instance.constructor.tool);
        }
        
        // Handle infrastructure automatically (signals, refs, props) before calling onMount
        this.setupComponentInfrastructure(instance, props);
        
        if (instance.onMount) {
          const wrapped = this.getWrappedMethod(instance, 'onMount');
          await wrapped(this.com);
        }

        // if (instance.onTickStart) {
        //   const wrapped = this.getWrappedMethod(instance, 'onTickStart');
        //   await wrapped(this.com, state || {});
        // }
      } else {
        instance = null;
      }
    }

    if (this.isClassComponent(type) || isDirectInstance) {
      let renderedElement: any;
      if (instance && instance.render) {
        const wrapped = this.getWrappedMethod(instance, 'render');
        renderedElement = await wrapped(this.com, state || {});

        if (renderedElement) {
          if (isFragment(renderedElement.type)) {
            children = await this.reconcileChildren(oldFiber, this.normalizeChildren(renderedElement.props.children), state);
          } else {
            const childFiber = await this.reconcile(oldFiber?.children[0] || null, renderedElement, state);
            children = childFiber ? [childFiber] : [];

            if (oldFiber && oldFiber.children && oldFiber.children.length > 1) {
              for (let i = 1; i < oldFiber.children.length; i++) {
                this.unmountFiber(oldFiber.children[i]);
              }
            }
          }
        } else {
          children = [];
          if (oldFiber && oldFiber.children) {
            for (const child of oldFiber.children) {
              this.unmountFiber(child);
            }
          }
        }
      }
    } else if (this.isPlainFunctionComponent(type)) {
      let renderedElement: any;

      const tickState: TickState = state || {
        tick: 1,
        stop: () => { }
      };

      const func = type as ((props?: any, com?: ContextObjectModel, state?: TickState) => JSX.Element | null);

      renderedElement = func(props, this.com, tickState);

      // Check for self-referential components (e.g., `function Row(props) { return createElement(Row, props); }`)
      // These are "terminal" components that would cause infinite recursion if we recurse into them
      const isSelfReferential = renderedElement && (
        renderedElement.type === type || 
        renderedElement.type?.name === type.name
      );

      if (isSelfReferential) {
        // Terminal component - reconcile its children, don't recurse into the element
        children = await this.reconcileChildren(oldFiber, this.normalizeChildren(renderedElement.props?.children), state);
      } else if (renderedElement && isFragment(renderedElement.type)) {
        children = await this.reconcileChildren(oldFiber, this.normalizeChildren(renderedElement.props.children), state);
      } else if (renderedElement) {
        const childFiber = await this.reconcile(oldFiber?.children[0] || null, renderedElement, state);
        children = childFiber ? [childFiber] : [];
        if (oldFiber && oldFiber.children && oldFiber.children.length > 1) {
          for (let i = 1; i < oldFiber.children.length; i++) {
            this.unmountFiber(oldFiber.children[i]);
          }
        }
      } else {
        children = [];
        if (oldFiber && oldFiber.children) {
          for (const child of oldFiber.children) {
            this.unmountFiber(child);
          }
        }
      }
    } else if ((type === Entry || type?.name === 'Entry') && props.kind === 'message') {
      // Entry with kind='message' - reconcile children so component render methods are called
      // This allows <Message><FormattedTextBlock /></Message> to work
      children = await this.reconcileChildren(oldFiber, childrenElements, state);
    } else {
      // Unknown type - reconcile children
      children = await this.reconcileChildren(oldFiber, childrenElements, state);
    }

    // Store ref if provided and instance exists
    const ref = props.ref;
    if (ref && instance) {
      this.com._setRef(ref, instance);
    }

    return {
      type,
      props,
      instance,
      children,
      key: element.key,
      ref
    };
  }

  private normalizeChildren(children: any): JSX.Element[] {
    if (children === undefined || children === null) return [];
    if (Array.isArray(children)) return children.flat().filter(c => isElement(c));
    if (isElement(children)) return [children];
    return [];
  }

  private isClassComponent(type: any): type is new (props: any) => Component {
    if (typeof type !== 'function') {
      return false;
    }

    if (!type.prototype) {
      return false;
    }

    let proto = type.prototype;
    while (proto && proto !== Object.prototype) {
      // Check by reference OR by name (for module identity issues with vite-node)
      if (proto.constructor === Component || proto.constructor?.name === 'Component') {
        return true;
      }
      if (this.isComponentLifecycleHooks(proto)) {
        if (proto.constructor === type || 
            proto.constructor.prototype === Component.prototype ||
            proto.constructor.prototype?.constructor?.name === 'Component') {
          return true;
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    if (this.isComponentLifecycleHooks(type.prototype)) {
      if (type.prototype.constructor === type) {
        return true;
      }
    }

    return false;
  }

  private isComponentLifecycleHooks(type: any): type is ComponentLifecycleHooks {
    if (typeof type !== 'object' || type === null) {
      return false;
    }

    return typeof type.onMount === 'function' || typeof type.onUnmount === 'function' || typeof type.onStart === 'function' || typeof type.onTickStart === 'function' || typeof type.onAfterCompile === 'function' || typeof type.onTickEnd === 'function' || typeof type.onComplete === 'function' || typeof type.onError === 'function' || typeof type.render === 'function';
  }

  private isPlainFunctionComponent(type: any): type is PureFunctionComponent {
    if (typeof type !== 'function') {
      return false;
    }

    if (this.isClassComponent(type)) {
      return false;
    }

    // Fragment is a Symbol, not a function component
    if (isFragment(type)) {
      return false;
    }

    return true;
  }

  /**
   * Register a static tool definition from a component class.
   * Converts flat tool format { name, description, parameters, run }
   * to ExecutableTool format { metadata: { name, description, parameters }, run }
   */
  private registerStaticTool(toolDef: any): void {
    if (!toolDef || (!toolDef.name && !toolDef.metadata?.name)) {
      log.warn('Static tool missing name, skipping registration');
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
          parameters: toolDef.parameters,
        },
        run: toolDef.run,
      };

      this.com.addTool(executableTool);
    }
  }

  private async unmountFiber(fiber: Fiber | null): Promise<void> {
    if (!fiber) return;
    
    // Unregister static tool if present on the class/constructor
    const toolDef = (fiber.type as any)?.tool || fiber.instance?.constructor?.tool;
    if (toolDef?.name) {
      this.com.removeTool(toolDef.name);
    }
    
    if (fiber.instance) {
      // Clean up infrastructure (signals, refs) before calling onUnmount
      this.cleanupComponentInfrastructure(fiber.instance);
      
      if (fiber.instance.onUnmount) {
        try {
          const wrapped = this.getWrappedMethod(fiber.instance, 'onUnmount');
          await wrapped(this.com);
        } catch (error: any) {
          // Ignore abort errors during unmount - execution was already aborted
          const isAbort = error?.name === 'AbortError' || error?.message?.includes('abort') || error?.message?.includes('cancelled');
          if (!isAbort) {
            // Re-throw non-abort errors
            throw error;
          }
        }
      }
    }
    for (const child of fiber.children) {
      await this.unmountFiber(child);
    }
  }

  /**
   * Set up component infrastructure automatically (signals, refs, props).
   * This is called by the compiler for all component instances, so components
   * don't need to extend EngineComponent just for signal binding and ref handling.
   * 
   * @param instance Component instance
   * @param props JSX props (must be set on instance.props before calling)
   */
  private setupComponentInfrastructure(instance: Component, props: any): void {
    // Store props on instance (for access in component methods)
    (instance as any).props = props;
    
    // Bind COM signals automatically (if component uses signals)
    bindCOMSignals(instance, this.com);

    // Bind props signals (input() signals)
    this.bindPropsSignals(instance, props);
    
    // Handle ref prop automatically (if provided)
    if (props?.ref && typeof props.ref === 'string') {
      this.com._setRef(props.ref, instance);
    }
  }

  /**
   * Binds all input() prop signals on a component instance.
   * Called automatically during component setup.
   * 
   * Similar to bindCOMSignals, but for props instead of COM state.
   * Detects properties marked with PROPS_SIGNAL_SYMBOL and binds them to actual prop values.
   */
  private bindPropsSignals(instance: Component, props: any): void {
    if (!props) return;
    
    // Store writable signal references for updates during reconciliation
    if (!(instance as any)._propsSignals) {
      (instance as any)._propsSignals = new Map<string, Signal<any>>();
    }
    const propsSignals = (instance as any)._propsSignals;
    
    const bindProperty = (propKey: string | symbol, value: any) => {
      // Check if this is a props signal
      if (value && typeof value === 'function' && (value as any)[PROPS_SIGNAL_SYMBOL] !== undefined) {
        const propKeyMarker = (value as any)[PROPS_SIGNAL_SYMBOL];
        
        // Determine the actual JSX prop key
        // If marker is true, infer from property name; otherwise use the marker as the key
        const jsxPropKey = propKeyMarker === true 
          ? (typeof propKey === 'string' ? propKey : undefined)
          : propKeyMarker;
        
        if (!jsxPropKey || typeof jsxPropKey !== 'string') {
          log.warn(`Cannot bind props signal: property "${String(propKey)}" has invalid prop key marker`);
          return;
        }
        
        // Get prop value from JSX props
        const propValue = props[jsxPropKey];

        console.info({ jsxPropKey, propValue, value, oldValue: value() }, 'Binding props signal');
        
        // Update the existing signal with prop value (or keep initial value if prop not provided)
        // The signal is already writable under the hood, just typed as ReadonlySignal
        if (propValue !== undefined) {
          (value as any).set(propValue);
        }

        console.info({ jsxPropKey, propValue, value, newValue: value() }, 'Bound props signal');
        
        // Store writable reference for compiler updates (cast to Signal to access .set())
        propsSignals.set(jsxPropKey, value as Signal<any>);
      }
    };
    
    // Scan all properties
    const instanceAny = instance as any;
    for (const key of Object.getOwnPropertyNames(instanceAny)) {
      bindProperty(key, instanceAny[key]);
    }
    
    const symbols = Object.getOwnPropertySymbols(instanceAny);
    for (const sym of symbols) {
      bindProperty(sym, instanceAny[sym]);
    }
  }

  /**
   * Updates props signals when props change during reconciliation.
   * Called when component already exists but props may have changed.
   */
  private updatePropsSignals(instance: Component, newProps: any): void {
    if (!newProps || !(instance as any)._propsSignals) return;
    
    const propsSignals = (instance as any)._propsSignals as Map<string, Signal<any>>;
    
    // Update each bound props signal with new prop values
    for (const [jsxPropKey, signal] of propsSignals.entries()) {
      const newValue = newProps[jsxPropKey];
      const currentValue = signal();
      console.info({ jsxPropKey, newValue, currentValue }, 'Updating props signal');
      // Update signal if prop value changed
      if (newValue !== currentValue) {
        signal.set(newValue !== undefined ? newValue : currentValue);
      }
    }
  }

  /**
   * Clean up component infrastructure (signals, refs).
   * Called automatically during unmount, so components don't need to handle this.
   * 
   * Props signals are cleaned up automatically via cleanupSignals (detected by PROPS_SIGNAL_SYMBOL).
   */
  private cleanupComponentInfrastructure(instance: Component): void {
    // Clean up signals (including props signals)
    cleanupSignals(instance);
    
    // Clean up props signals map
    if ((instance as any)._propsSignals) {
      (instance as any)._propsSignals.clear();
      delete (instance as any)._propsSignals;
    }
    
    // Remove ref if it was set
    const props = (instance as any).props;
    if (props?.ref && typeof props.ref === 'string') {
      this.com._removeRef(props.ref);
    }
  }

  private wrapComponentMethods(instance: Component): void {
    if (!this.hookRegistry) {
      return;
    }

    const componentClass = instance.constructor;
    const componentName = getComponentName(instance, componentClass);
    const componentTags = getComponentTags(componentClass);

    const methodsToWrap: ComponentHookName[] = [
      'onMount',
      'onUnmount',
      'onStart',
      'onTickStart',
      'render',
      'onTickEnd',
      'onComplete',
      'onError',
    ];

    for (const methodName of methodsToWrap) {
      if (typeof instance[methodName] === 'function') {
        const originalMethod = instance[methodName].bind(instance);
        const middleware = this.hookRegistry!.getMiddleware(
          methodName,
          componentClass,
          componentName,
          componentTags
        );

        // Create a Procedure for the component method with middleware applied
        // Component lifecycle methods are now Procedures, aligned with kernel
        const procedure = createEngineProcedure(
          { name: methodName },
          originalMethod as any
        ).use(...(middleware as any[]));

        if (!this.wrappedMethods.has(instance)) {
          this.wrappedMethods.set(instance, new Map());
        }
        this.wrappedMethods.get(instance)!.set(methodName, procedure);
      }
    }
  }

  private getWrappedMethod(instance: Component, methodName: ComponentHookName): Function {
    const wrapped = this.wrappedMethods.get(instance)?.get(methodName);
    if (wrapped) {
      return wrapped;
    }
    return instance[methodName]?.bind(instance) || (() => {});
  }

  /**
   * Generic fiber tree traversal with visitor pattern.
   * Visits each fiber in depth-first order, calling the visitor function.
   */
  private async traverse(fiber: Fiber | null, visitor: (fiber: Fiber) => Promise<void> | void): Promise<void> {
    if (!fiber) return;
    await visitor(fiber);
    for (const child of fiber.children) {
      await this.traverse(child, visitor);
    }
  }

  /**
   * Notifies all components that execution is starting.
   * Called before the first tick, after the COM is created.
   */
  async notifyStart(com: ContextObjectModel) {
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onStart === 'function') {
        await fiber.instance.onStart(com);
      }
    });
  }

  /**
   * Notifies all active component instances that a tick is starting.
   * Also re-registers all tools from the fiber tree (handles module identity issues).
   */
  async notifyTickStart(state: TickState) {
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onTickStart === 'function') {
        const wrapped = this.getWrappedMethod(fiber.instance, 'onTickStart');
        // Pass com to onTickStart so components can re-register tools after com.clear()
        try {
          await wrapped(this.com, state);
        } catch (err) {
          const instanceName = fiber.instance.constructor?.name || 'unknown';
          log.error({ err, component: instanceName }, 'onTickStart error');
        }
      }
    });
    // Re-register tools from fiber tree after notifyTickStart
    // This handles cases where onTickStart inheritance doesn't work due to module identity
    await this.reregisterToolsFromFibers(this.rootFiber);
  }

  /**
   * Re-registers all ExecutableTool instances from the fiber tree.
   * This ensures tools match the current JSX tree each tick, supporting:
   * - Conditional tool rendering (tools can be added/removed dynamically)
   * - Module identity issues (onTickStart inheritance may not work)
   */
  private async reregisterToolsFromFibers(fiber: Fiber | null) {
    if (!fiber) return;
    
    const instance = fiber.instance;
    const constructor = instance?.constructor as any;
    
    // Pattern 1: createTool() - static metadata and run on class
    const metadata = constructor?.metadata || instance?.metadata;
    const run = constructor?.run || instance?.run;
    
    if (metadata?.name && typeof run === 'function') {
      this.com.addTool({ metadata, run });
    }
    
    // Pattern 2: Component with static tool property (e.g., static tool = todoListTool)
    const staticTool = constructor?.tool;
    if (staticTool?.metadata?.name && typeof staticTool?.run === 'function') {
      this.com.addTool(staticTool);
    }
    
    // Pattern 3: Instance tool property
    const instanceTool = instance?.tool;
    if (instanceTool?.metadata?.name && typeof instanceTool?.run === 'function' && instanceTool !== staticTool) {
      this.com.addTool(instanceTool);
    }
    
    for (const child of fiber.children) {
      await this.reregisterToolsFromFibers(child);
    }
  }

  /**
   * Notifies components that a tick has ended.
   * Components can use this for per-tick processing, validation, or side effects.
   */
  async notifyTickEnd(state: TickState) {
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onTickEnd === 'function') {
        try {
          const wrapped = this.getWrappedMethod(fiber.instance, 'onTickEnd');
          await wrapped(this.com, state);
        } catch (error: any) {
          // If component has onError handler, call it
          if (fiber.instance && typeof fiber.instance.onError === 'function') {
            const errorState: TickState = {
              ...state,
              error: {
                error: error instanceof Error ? error : new Error(String(error)),
                phase: 'tick_end',
                recoverable: true,
              }
            };
            const errorWrapped = this.getWrappedMethod(fiber.instance, 'onError');
            await errorWrapped(this.com, errorState);
          } else {
            // Re-throw if no error handler
            throw error;
          }
        }
      }
    });
  }

  /**
   * Notifies components about an error and collects recovery actions.
   * Returns the first recovery action that indicates continuation, or null if no recovery.
   */
  async notifyError(state: TickState): Promise<RecoveryAction | null> {
    const recoveryActions: RecoveryAction[] = [];
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onError === 'function') {
        try {
          const wrapped = this.getWrappedMethod(fiber.instance, 'onError');
          const recovery = await wrapped(this.com, state);
          if (recovery) {
            recoveryActions.push(recovery);
          }
        } catch (error: any) {
          // If onError itself throws, log but don't propagate (to allow other components to handle)
          log.error({ err: error }, 'Error in component onError handler');
        }
      }
    });
    
    // Return the first recovery action that wants to continue, or null
    return recoveryActions.find(action => action.continue) || null;
  }

  /**
   * Notifies components that execution is complete and collects any JSX they return.
   * Returns the collected JSX elements so they can be compiled and applied.
   */
  async notifyComplete(finalState: COMInput): Promise<void> {
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onComplete === 'function') {
        const wrapped = this.getWrappedMethod(fiber.instance, 'onComplete');
        await wrapped(this.com, finalState);
      }
    });
  }

  /**
   * Unmounts the tree, calling onUnmount handlers
   */
  async unmount() {
    await this.unmountFiber(this.rootFiber);
  }

  /**
   * Compiles the JSX tree until the output is stable (no components request recompile).
   * 
   * The stabilization loop:
   * 1. Compile the tree (calls render() on components)
   * 2. Notify components via onAfterCompile (they can inspect compiled output)
   * 3. If any component called com.requestRecompile(), go to step 1
   * 4. Stop when stable or max iterations reached
   * 
   * @param rootElement The root JSX element to compile
   * @param state Current tick state
   * @param options Stabilization options
   * @returns The stable compiled structure and metadata
   */
  async compileUntilStable(
    rootElement: JSX.Element,
    state: TickState,
    options: CompileStabilizationOptions = {}
  ): Promise<CompileStabilizationResult> {
    const maxIterations = options.maxIterations ?? 10;
    const trackMutations = options.trackMutations ?? (process.env['NODE_ENV'] === 'development');
    
    let iterations = 0;
    const allRecompileReasons: string[] = [];
    let compiled: CompiledStructure;
    
    do {
      // Reset recompile tracking for this iteration
      this.com._resetRecompileRequest();
      
      // Step 1: Compile the tree
      compiled = await this.compile(rootElement, state);
      
      // Step 2: Create AfterCompileContext (just metadata now)
      const ctx: AfterCompileContext = {
        iteration: iterations,
        maxIterations,
      };
      
      // Step 3: Notify components via onAfterCompile
      if (trackMutations) {
        await this.notifyAfterCompileWithMutationTracking(compiled, state, ctx);
      } else {
        await this.notifyAfterCompile(compiled, state, ctx);
      }
      
      // Collect recompile reasons from this iteration
      const iterationReasons = this.com._getRecompileReasons();
      for (const reason of iterationReasons) {
        allRecompileReasons.push(`[iteration ${iterations}] ${reason}`);
      }
      
      iterations++;
      
      // Step 4: Check if we should continue
      if (!this.com._wasRecompileRequested()) {
        break; // Stable!
      }
      
      if (iterations >= maxIterations) {
        log.warn(
          { maxIterations, reasons: allRecompileReasons },
          'Compilation stabilization hit max iterations'
        );
        break; // Forced stable
      }
      
    } while (true);
    
    return {
      compiled: compiled!,
      iterations,
      forcedStable: iterations >= maxIterations && this.com._wasRecompileRequested(),
      recompileReasons: allRecompileReasons,
    };
  }

  /**
   * Notifies all active component instances that compilation is complete.
   * Components can inspect the compiled structure and call com.requestRecompile().
   */
  async notifyAfterCompile(compiled: CompiledStructure, state: TickState, ctx: AfterCompileContext): Promise<void> {
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onAfterCompile === 'function') {
        const instanceName = fiber.instance.constructor?.name || 'unknown';
        try {
          const wrapped = this.getWrappedMethod(fiber.instance, 'onAfterCompile');
          await wrapped(this.com, compiled, state, ctx);
        } catch (err) {
          log.error({ err, component: instanceName }, 'onAfterCompile error');
        }
      }
    });
  }

  /**
   * Notifies components with mutation tracking enabled (development mode).
   * Warns if a component modifies COM but doesn't call com.requestRecompile().
   */
  private async notifyAfterCompileWithMutationTracking(
    compiled: CompiledStructure, 
    state: TickState, 
    ctx: AfterCompileContext
  ): Promise<void> {
    await this.traverse(this.rootFiber, async (fiber) => {
      if (fiber.instance && typeof fiber.instance.onAfterCompile === 'function') {
        const instanceName = fiber.instance.constructor?.name || 'unknown';
        
        // Track COM state before hook
        const beforeSnapshot = this.snapshotCOMState();
        const recompileRequestedBefore = this.com._wasRecompileRequested();
        
        try {
          const wrapped = this.getWrappedMethod(fiber.instance, 'onAfterCompile');
          await wrapped(this.com, compiled, state, ctx);
          
          // Track COM state after hook
          const afterSnapshot = this.snapshotCOMState();
          const recompileRequestedAfter = this.com._wasRecompileRequested();
          
          // Check for mutations without requestRecompile
          const mutations = this.detectMutations(beforeSnapshot, afterSnapshot);
          const didRequestRecompile = recompileRequestedAfter && !recompileRequestedBefore;
          
          if (mutations.length > 0 && !didRequestRecompile) {
            log.warn(
              { component: instanceName, mutations },
              'Component modified COM during onAfterCompile without calling requestRecompile.\n' +
              `  This change will NOT be reflected in the compiled output. Call com.requestRecompile() to trigger re-compilation.`
            );
          }
        } catch (err) {
          log.error({ err, component: instanceName }, 'onAfterCompile error');
        }
      }
    });
  }

  /**
   * Creates a snapshot of COM state for mutation detection.
   */
  private snapshotCOMState(): { timelineLength: number; sectionIds: string[]; toolCount: number } {
    return {
      timelineLength: this.com.getTimeline().length,
      sectionIds: Object.keys(this.com.getSections()),
      toolCount: this.com.getTools().length,
    };
  }

  /**
   * Detects mutations between two COM snapshots.
   */
  private detectMutations(
    before: { timelineLength: number; sectionIds: string[]; toolCount: number },
    after: { timelineLength: number; sectionIds: string[]; toolCount: number }
  ): string[] {
    const mutations: string[] = [];
    
    if (before.timelineLength !== after.timelineLength) {
      mutations.push(`timeline (${before.timelineLength} → ${after.timelineLength})`);
    }
    
    const addedSections = after.sectionIds.filter(id => !before.sectionIds.includes(id));
    const removedSections = before.sectionIds.filter(id => !after.sectionIds.includes(id));
    if (addedSections.length > 0) {
      mutations.push(`sections added: ${addedSections.join(', ')}`);
    }
    if (removedSections.length > 0) {
      mutations.push(`sections removed: ${removedSections.join(', ')}`);
    }
    
    if (before.toolCount !== after.toolCount) {
      mutations.push(`tools (${before.toolCount} → ${after.toolCount})`);
    }
    
    return mutations;
  }
}

