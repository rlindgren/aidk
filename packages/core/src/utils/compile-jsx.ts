import type { JSX } from "aidk/jsx-runtime";
import { ContextObjectModel } from "../com/object-model";
import type { COMInput, EngineInput } from "../com/types";
import { FiberCompiler, type CompileStabilizationOptions } from "../compiler/compiler_v1";
import { MarkdownRenderer, type ContentRenderer } from "../renderers";
import { StructureRenderer } from "../structure-renderer/structure-renderer";
import { ensureElement } from "../jsx/jsx-runtime";

/**
 * Simple compileJSX function for basic use cases.
 * For full Engine-like setup with hooks, tools, MCP, etc., use CompileJSXService.
 * 
 * @deprecated Use CompileJSXService for full-featured compilation.
 */
export async function compileJSX(jsx: JSX.Element, options: {
  renderer?: ContentRenderer;
  initialInput?: Partial<COMInput>;
} = {}) {
  options.renderer ??= new MarkdownRenderer();
  options.initialInput ??= { timeline: [], sections: {} };

  // Minimal COM (no process management, channelService, etc.)
  const com = new ContextObjectModel(
    { metadata: {}, modelOptions: undefined },
    options.initialInput,
    undefined, // No channel service
    undefined  // No process methods
  );
  
  const compiler = new FiberCompiler(com);
  const structureRenderer = new StructureRenderer(com);
  structureRenderer.setDefaultRenderer(options.renderer);

  const tickState = {
    tick: 1,
    previousState: undefined,
    currentState: {
      ...options.initialInput,
      timeline: options.initialInput.timeline || [],
      sections: options.initialInput.sections || {},
    },
    stopReason: undefined,
    stop: (reason: string) => {
      throw new Error(reason);
    },
    channels: undefined
  };
  
  // Ensure element is a JSX.Element
  const rootElement = ensureElement(jsx);
  
  // Compile JSX
  const { compiled } = await compiler.compileUntilStable(rootElement, tickState, {
    maxIterations: 10,
    trackMutations: process.env['NODE_ENV'] === 'development',
  } as CompileStabilizationOptions);
  
  // Apply & format
  structureRenderer.apply(compiled);
  // Format input (event blocks will be formatted, native blocks will pass through)
  const formatted = structureRenderer.formatInput(com.toInput());
  
  return {
    com,           // Full COM state
    compiled,      // Raw structures
    formatted,     // Final output
    ...formatted
  };
}

// Re-export CompileJSXService for full-featured compilation
export { CompileJSXService, type CompileJSXServiceConfig, type CompileJSXResult } from './compile-jsx-service';