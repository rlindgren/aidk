/**
 * # AIDK Renderers
 *
 * Content renderers for transforming semantic content blocks into various
 * output formats (Markdown, XML, etc.).
 *
 * ## Available Renderers
 *
 * - **MarkdownRenderer** - Render to GitHub-flavored Markdown
 * - **XMLRenderer** - Render to XML format
 * - **ContentRenderer** - Base class for custom renderers
 *
 * ## Quick Start
 *
 * ```typescript
 * import { MarkdownRenderer } from 'aidk/renderers';
 *
 * const renderer = new MarkdownRenderer();
 * const markdown = renderer.render(contentBlocks);
 * ```
 *
 * @see {@link ContentRenderer} - Base renderer class
 * @see {@link MarkdownRenderer} - Markdown output
 * @see {@link XMLRenderer} - XML output
 *
 * @module aidk/renderers
 */

export {
  Renderer as ContentRenderer,
  type SemanticContentBlock,
  type SemanticNode,
  type SemanticType,
} from "./base";
export { MarkdownRenderer } from "./markdown";
export { XMLRenderer } from "./xml";
