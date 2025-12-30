import { type JSX, isElement } from "../jsx/jsx-runtime";
import { Row, Column, List, ListItem } from "../jsx/components/semantic";
import type { SemanticNode, SemanticType } from "../renderers/base";
import type { ContentRenderer } from "../renderers";

/**
 * Fiber-like structure for text extraction.
 * Legacy interface kept for backward compatibility.
 */
export interface FiberLike {
  type: any;
  props: any;
  children: FiberLike[];
}

/**
 * Map of inline element types to their semantic types.
 * Used to convert JSX element types to semantic formatting hints.
 *
 * Design principle:
 * - Capitalized components (Text, Image, Audio, Video, Document) are STRUCTURAL
 *   and create native ContentBlocks at the top level
 * - Lowercase HTML elements (img, audio, video) are SEMANTIC and get converted
 *   to inline representations (markdown) when nested inside text content
 */
/**
 * Single source of truth for semantic element types.
 * These elements are handled automatically when nested inside text content.
 * They should NOT be used at the top level - use structural components instead.
 */
const INLINE_SEMANTIC_TYPES: Record<string, SemanticType> = {
  // Inline text formatting
  inlineCode: "code",
  code: "code",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  mark: "mark",
  u: "underline",
  s: "strikethrough",
  del: "strikethrough",
  sub: "subscript",
  sup: "superscript",
  small: "small",

  // Links and semantic elements
  a: "link",
  q: "quote",
  cite: "citation",
  kbd: "keyboard",
  var: "variable",

  // Block-level semantic containers
  p: "paragraph",
  blockquote: "blockquote",

  // Native HTML media elements (semantic, converted to inline markdown)
  img: "image",
  audio: "audio",
  video: "video",
};

/**
 * Extracts semantic node tree from JSX element or fiber-like structure.
 * Builds a semantic tree structure that preserves formatting information
 * without applying any specific formatting syntax.
 *
 * @example
 * ```tsx
 * <Text>Hello <strong>world</strong> with <inlineCode>code</inlineCode></Text>
 * ```
 * Returns:
 * ```typescript
 * {
 *   children: [
 *     { text: 'Hello ' },
 *     { semantic: 'strong', children: [{ text: 'world' }] },
 *     { text: ' with ' },
 *     { semantic: 'code', children: [{ text: 'code' }] }
 *   ]
 * }
 * ```
 */
export function extractSemanticNode(
  fiber: FiberLike,
  currentRenderer?: ContentRenderer,
): SemanticNode {
  const extract = (node: any, rendererContext?: ContentRenderer): SemanticNode | SemanticNode[] => {
    if (typeof node === "string") {
      return { text: node };
    }

    if (node && typeof node === "object") {
      if (isElement(node)) {
        // Get the element type as a string for lookup
        const typeName =
          typeof node.type === "string" ? node.type : node.type?.name?.toLowerCase?.() || "";

        // Extract children first
        const children = node.props?.children;
        let childNodes: SemanticNode[] = [];

        if (Array.isArray(children)) {
          childNodes = children.map((child) => extract(child, rendererContext)).flat();
        } else if (children !== undefined && children !== null) {
          const extracted = extract(children, rendererContext);
          childNodes = Array.isArray(extracted) ? extracted : [extracted];
        }

        // Check if this is an inline formatting element
        const semanticType = INLINE_SEMANTIC_TYPES[typeName];
        if (semanticType) {
          // For media types, capture props for inline rendering
          if (semanticType === "image" || semanticType === "audio" || semanticType === "video") {
            return {
              semantic: semanticType,
              props: node.props || {},
              children: childNodes,
            };
          }

          // Return semantic node with children
          return {
            semantic: semanticType,
            children: childNodes,
          };
        }

        // Non-semantic element - return children flattened
        return childNodes;
      } else if ("text" in node) {
        return { text: node.text };
      }
    }

    return { text: "" };
  };

  const children: SemanticNode[] = [];

  // Extract from props.children
  if (fiber.props?.children) {
    const propsChildren = Array.isArray(fiber.props.children)
      ? fiber.props.children
      : [fiber.props.children];

    for (const child of propsChildren) {
      const extracted = extract(child);
      if (Array.isArray(extracted)) {
        children.push(...extracted);
      } else {
        children.push(extracted);
      }
    }
  }

  // Also extract from fiber.children (semantic primitives can have children in the fiber tree)
  for (const child of fiber.children) {
    if (child.props?.children) {
      const fiberChildren = Array.isArray(child.props.children)
        ? child.props.children
        : [child.props.children];

      for (const fiberChild of fiberChildren) {
        const extracted = extract(fiberChild);
        if (Array.isArray(extracted)) {
          children.push(...extracted);
        } else {
          children.push(extracted);
        }
      }
    }
  }

  // Return container with children (even if single child, preserve structure)
  if (children.length === 0) {
    return currentRenderer ? { renderer: currentRenderer, children: [] } : { text: "" };
  }

  // If we have renderer context and no child has renderer, attach it to root
  const hasRendererInChildren = children.some(
    (n) => n && typeof n === "object" && "renderer" in n && n.renderer !== undefined,
  );

  const rootNode: SemanticNode = { children };
  if (currentRenderer && !hasRendererInChildren) {
    rootNode.renderer = currentRenderer;
  }

  return rootNode;
}

/**
 * Extracts semantic node from JSX element (for use in content block registry).
 * Only extracts from props.children (not fiber.children).
 */
export function extractSemanticNodeFromElement(
  element: JSX.Element,
  currentRenderer?: ContentRenderer,
): SemanticNode {
  const extract = (node: any, rendererContext?: ContentRenderer): SemanticNode | SemanticNode[] => {
    if (typeof node === "string") {
      return { text: node };
    }

    if (node && typeof node === "object") {
      if (isElement(node)) {
        const typeName =
          typeof node.type === "string" ? node.type : node.type?.name?.toLowerCase?.() || "";

        // Check for Renderer component (enables nested renderer switching)
        // This handles both direct <Renderer> usage and wrapper components like <XML>, <Markdown>
        // that return <Renderer instance={...}>
        if (typeof node.type === "function") {
          // Call the component to see what it returns
          const rendered = node.type(node.props);

          // Check if returned element is a Renderer (has instance prop)
          // This works for both direct <Renderer> and wrappers like <XML> that return <Renderer>
          if (
            rendered &&
            typeof rendered === "object" &&
            "props" in rendered &&
            rendered.props?.instance
          ) {
            const renderer = rendered.props.instance;
            const children = rendered.props?.children || node.props?.children;
            let childNodes: SemanticNode[] = [];

            if (Array.isArray(children)) {
              childNodes = children.map((child) => extract(child, renderer)).flat();
            } else if (children !== undefined && children !== null) {
              const extracted = extract(children, renderer);
              childNodes = Array.isArray(extracted) ? extracted : [extracted];
            }

            // Return a node with renderer attached - this marks the renderer boundary
            return {
              renderer: renderer,
              children: childNodes,
            };
          }

          // If component returned an element but it's not a Renderer, extract from it
          if (rendered && typeof rendered === "object" && "type" in rendered) {
            return extract(rendered, rendererContext);
          }
        }

        // Fallback: Check for Renderer by name (for direct usage when type is not a function)
        if (node.type?.name === "Renderer" || typeName === "renderer") {
          const renderer = node.props?.instance;
          const children = node.props?.children;
          let childNodes: SemanticNode[] = [];

          if (Array.isArray(children)) {
            childNodes = children.map((child) => extract(child, renderer)).flat();
          } else if (children !== undefined && children !== null) {
            const extracted = extract(children, renderer);
            childNodes = Array.isArray(extracted) ? extracted : [extracted];
          }

          return {
            renderer: renderer,
            children: childNodes,
          };
        }

        const children = node.props?.children;
        let childNodes: SemanticNode[] = [];

        if (Array.isArray(children)) {
          childNodes = children.map((child) => extract(child, rendererContext)).flat();
        } else if (children !== undefined && children !== null) {
          const extracted = extract(children, rendererContext);
          childNodes = Array.isArray(extracted) ? extracted : [extracted];
        }

        const semanticType = INLINE_SEMANTIC_TYPES[typeName];
        if (semanticType) {
          // Only capture props that are actually needed for specific semantic types
          let props: Record<string, any> | undefined;

          if (semanticType === "link" && node.props?.href) {
            props = { href: node.props.href };
          } else if (
            (semanticType === "image" || semanticType === "audio" || semanticType === "video") &&
            node.props
          ) {
            // Capture media-specific props (src, alt, etc.) but exclude children
            props = Object.fromEntries(
              Object.entries(node.props).filter(([key]) => key !== "children"),
            );
          }
          // For other semantic types (strong, em, code, etc.), no props needed

          return {
            semantic: semanticType,
            ...(props && Object.keys(props).length > 0 ? { props } : {}),
            children: childNodes,
          };
        }

        // Unknown element - treat as custom, preserve props and tag name
        if (typeName) {
          return {
            semantic: "custom" as any,
            props: { ...node.props, _tagName: typeName },
            children: childNodes,
          };
        }

        return childNodes;
      } else if ("text" in node) {
        return { text: node.text };
      }
    }

    return { text: "" };
  };

  const props = element.props || {};
  if (props.children !== undefined && props.children !== null) {
    const children = Array.isArray(props.children) ? props.children : [props.children];
    const extracted = children.map((child: any) => extract(child, currentRenderer)).flat();

    if (extracted.length === 0) {
      return currentRenderer && currentRenderer !== undefined
        ? { renderer: currentRenderer, children: [] }
        : { text: "" };
    }

    // If we have renderer context and root doesn't have renderer, attach it
    const rootNode: SemanticNode = { children: extracted };
    if (
      currentRenderer &&
      !extracted.some((n: any) => n && typeof n === "object" && "renderer" in n)
    ) {
      rootNode.renderer = currentRenderer;
    }

    return rootNode;
  }

  return currentRenderer && currentRenderer !== undefined
    ? { renderer: currentRenderer, children: [] }
    : { text: "" };
}

/**
 * Extracts plain text from JSX element recursively (no formatting).
 * Used for extracting text from table cells, list items, etc.
 */
export function extractTextFromElement(element: JSX.Element): string {
  const extract = (node: any): string => {
    if (typeof node === "string") {
      return node;
    }

    if (node && typeof node === "object") {
      if (isElement(node)) {
        const children = node.props?.children;
        if (Array.isArray(children)) {
          return children.map(extract).join("");
        } else if (children !== undefined && children !== null) {
          return extract(children);
        }
      } else if ("text" in node) {
        return node.text;
      }
    }

    return "";
  };

  const props = element.props || {};
  if (props.children !== undefined && props.children !== null) {
    const children = Array.isArray(props.children) ? props.children : [props.children];
    return children.map(extract).join("");
  }

  return "";
}

/**
 * Extracts cell data from a Row element.
 */
function extractRowData(rowElement: JSX.Element): {
  cells: string[];
  alignments: ("left" | "center" | "right")[];
} {
  const cells: string[] = [];
  const alignments: ("left" | "center" | "right")[] = [];

  const props = rowElement.props || {};
  const rawChildren = props.children;
  const children = Array.isArray(rawChildren)
    ? rawChildren.flat()
    : rawChildren
      ? [rawChildren]
      : [];

  for (const child of children) {
    if (!isElement(child)) {
      // Plain string child
      if (typeof child === "string") {
        cells.push(child);
        alignments.push("left");
      }
      continue;
    }

    if (child.type === Column || child.type === "column") {
      const text = extractTextFromElement(child);
      cells.push(text);
      alignments.push(child.props?.align || "left");
    }
  }

  return { cells, alignments };
}

/**
 * Extracts table structure from a Table JSX element.
 * Handles both props-based (headers/rows) and children-based (Row/Column) definitions.
 */
export function extractTableStructure(tableElement: JSX.Element): {
  headers: string[];
  rows: string[][];
  alignments?: ("left" | "center" | "right")[];
} {
  const props = tableElement.props || {};

  // If headers/rows are provided as props, use those directly
  if (props.headers && props.rows) {
    return {
      headers: props.headers,
      rows: props.rows,
    };
  }

  // Otherwise, extract from Row/Column children
  const headers: string[] = [];
  const rows: string[][] = [];
  const alignments: ("left" | "center" | "right")[] = [];

  const rawChildren = props.children;
  const children = Array.isArray(rawChildren)
    ? rawChildren.flat()
    : rawChildren
      ? [rawChildren]
      : [];

  for (const child of children) {
    if (!isElement(child)) continue;

    if (child.type === Row || child.type === "row") {
      const rowData = extractRowData(child);

      if (child.props?.header) {
        // This is a header row
        headers.push(...rowData.cells);
        if (rowData.alignments.length > 0 && alignments.length === 0) {
          alignments.push(...rowData.alignments);
        }
      } else {
        rows.push(rowData.cells);
        // Capture alignments from first data row if not already set
        if (rowData.alignments.length > 0 && alignments.length === 0) {
          alignments.push(...rowData.alignments);
        }
      }
    }
  }

  return {
    headers,
    rows,
    alignments: alignments.length > 0 ? alignments : undefined,
  };
}

/**
 * Extracts data from a ListItem element, including nested lists and checked state.
 */
function extractListItemData(
  itemElement: JSX.Element,
): string | { text: string; checked?: boolean; nested?: any } {
  const props = itemElement.props || {};
  const rawChildren = props.children;
  const children = Array.isArray(rawChildren)
    ? rawChildren.flat()
    : rawChildren
      ? [rawChildren]
      : [];

  let text = "";
  let nested: any = undefined;
  const checked = props.checked;

  for (const child of children) {
    if (typeof child === "string") {
      text += child;
    } else if (isElement(child)) {
      if (child.type === List || child.type === "list") {
        // Nested list
        nested = extractListStructure(child);
      } else {
        // Other element - extract text
        text += extractTextFromElement(child);
      }
    }
  }

  // Return object form if we have nested list or checked state
  if (nested !== undefined || checked !== undefined) {
    return {
      text: text.trim(),
      ...(checked !== undefined ? { checked } : {}),
      ...(nested !== undefined ? { nested } : {}),
    };
  }
  return text.trim();
}

/**
 * Extracts list structure from a List JSX element.
 */
export function extractListStructure(listElement: JSX.Element): {
  ordered: boolean;
  task?: boolean;
  items: (string | { text: string; checked?: boolean; nested?: any })[];
} {
  const props = listElement.props || {};
  const ordered = props.ordered === true;
  const task = props.task === true ? true : undefined;
  const items: (string | { text: string; checked?: boolean; nested?: any })[] = [];

  const rawChildren = props.children;
  const children = Array.isArray(rawChildren)
    ? rawChildren.flat()
    : rawChildren
      ? [rawChildren]
      : [];

  for (const child of children) {
    if (!isElement(child)) {
      if (typeof child === "string") {
        items.push(child);
      }
      continue;
    }

    if (child.type === ListItem || child.type === "li" || child.type === "listitem") {
      const itemData = extractListItemData(child);
      items.push(itemData);
    }
  }

  return { ordered, ...(task ? { task } : {}), items };
}
