import { COM } from "../com/object-model";
import type { COMInput, COMSection, COMTimelineEntry } from "../com/types";
import type { ContentBlock, TextBlock } from "aidk-shared";
import { ContentRenderer, type SemanticContentBlock, MarkdownRenderer } from "../renderers";
import type {
  CompiledStructure,
  CompiledSection,
  CompiledTimelineEntry,
  CompiledEphemeral,
} from "../compiler/types";

/**
 * Consolidate contiguous text blocks into single text blocks.
 * Non-text blocks act as boundaries.
 *
 * @example
 * [text, text, image, text, text] → [consolidated-text, image, consolidated-text]
 */
function consolidateTextBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  let textBuffer: string[] = [];

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      result.push({ type: "text" as const, text: textBuffer.join("\n\n") });
      textBuffer = [];
    }
  };

  for (const block of blocks) {
    if (block.type === "text") {
      textBuffer.push((block as TextBlock).text);
    } else {
      flushTextBuffer();
      result.push(block);
    }
  }

  flushTextBuffer();
  return result;
}

/**
 * StructureRenderer: Applies CompiledStructure to COM and formats content.
 *
 * Responsibilities:
 * - Application (CompiledStructure → COM)
 * - Formatting (SemanticContentBlocks → ContentBlocks)
 * - Caching formatted content on sections
 *
 * Formatting Rules:
 * - Sections: Always formatted (system content), cached on section
 * - Timeline entries: Only formatted if explicitly wrapped in renderer tag
 */
export class StructureRenderer {
  private defaultRenderer: ContentRenderer;

  constructor(private com: COM) {
    this.defaultRenderer = new MarkdownRenderer();
  }

  setDefaultRenderer(renderer: ContentRenderer): void {
    this.defaultRenderer = renderer;
  }

  /**
   * Applies compiled structure to COM and formats content.
   */
  apply(compiled: CompiledStructure): void {
    // 1. Apply sections (format and cache)
    for (const section of compiled.sections.values()) {
      this.applySection(section);
    }

    // 2. Apply timeline entries (preserve ContentBlocks unless explicitly formatted)
    for (const entry of compiled.timelineEntries) {
      this.applyTimelineEntry(entry);
    }

    // 3. Consolidate system message
    this.consolidateSystemMessage(compiled.systemMessageItems);

    // 4. Apply tools
    for (const { name: _name, tool } of compiled.tools) {
      this.com.addTool(tool);
    }

    // 5. Apply ephemeral entries (NOT persisted)
    for (const ephemeral of compiled.ephemeral) {
      this.applyEphemeral(ephemeral);
    }

    // 6. Apply metadata
    for (const [key, value] of Object.entries(compiled.metadata)) {
      this.com.addMetadata(key, value);
    }
  }

  /**
   * Applies a section to COM.
   * Formats content immediately and caches it on the section.
   */
  private applySection(compiled: CompiledSection): void {
    const renderer = compiled.renderer || this.defaultRenderer;

    let formattedContent: ContentBlock[] | undefined;

    if (Array.isArray(compiled.content)) {
      // Format SemanticContentBlocks → ContentBlocks
      formattedContent = renderer.format(compiled.content as SemanticContentBlock[]);
    }

    const section: COMSection = {
      id: compiled.id,
      title: compiled.title,
      content: compiled.content, // Raw content (SemanticContentBlocks)
      formattedContent, // Cached formatted content
      formattedWith: renderer.constructor.name, // Track which renderer formatted it
      visibility: compiled.visibility,
      audience: compiled.audience,
      tags: compiled.tags,
      metadata: compiled.metadata,
      renderer: compiled.renderer, // Preserve renderer for system message consolidation
    };

    this.com.addSection(section);
  }

  /**
   * Applies an ephemeral entry to COM.
   * Ephemeral entries are NOT persisted - they provide current context.
   *
   * Consolidates contiguous text blocks for cleaner model input.
   */
  private applyEphemeral(compiled: CompiledEphemeral): void {
    const renderer = compiled.renderer || this.defaultRenderer;

    // Format SemanticContentBlocks → ContentBlocks
    const formattedContent = renderer.format(compiled.content);

    // Consolidate contiguous text blocks (like system messages)
    const consolidatedContent = consolidateTextBlocks(formattedContent);

    this.com.addEphemeral(
      consolidatedContent,
      compiled.position,
      compiled.order,
      compiled.metadata,
      compiled.id,
      compiled.tags,
      compiled.type,
    );
  }

  /**
   * Applies a timeline entry to COM.
   * Only formats if explicitly wrapped in renderer tag.
   */
  private applyTimelineEntry(compiled: CompiledTimelineEntry): void {
    if (compiled.kind === "message" && compiled.message) {
      // Store renderer reference in metadata for later formatting
      const metadata = {
        ...compiled.metadata,
        renderer: compiled.renderer, // Store renderer reference for formatInput()
      };

      this.com.addMessage(
        {
          ...compiled.message,
          // Preserve SemanticContentBlocks - will be formatted only if renderer set
          content: compiled.message.content as SemanticContentBlock[],
        } as any,
        {
          tags: compiled.tags,
          visibility: compiled.visibility,
          metadata,
        },
      );
    } else if (compiled.kind === "event" && compiled.event) {
      const entry: COMTimelineEntry = {
        kind: "event",
        message: {
          role: "system",
          content: [],
        },
        id: compiled.id,
        visibility: compiled.visibility,
        tags: compiled.tags,
        metadata: { ...compiled.metadata, event: compiled.event },
      };

      this.com.addTimelineEntry(entry);
    }
  }

  /**
   * Consolidates system message items into a single system message.
   * Creates a single, well-formatted text block for the system prompt.
   */
  private consolidateSystemMessage(
    items: Array<{
      type: "section" | "message" | "loose";
      sectionId?: string;
      content?: SemanticContentBlock[];
      index: number;
      renderer?: ContentRenderer;
    }>,
  ): void {
    if (items.length === 0) return;

    // Sort by index (render order)
    const sorted = [...items].sort((a, b) => a.index - b.index);

    const sectionsMap = new Map<string, COMSection>();

    // Get sections from COM for reference (they're already added by applySection)
    const sections = (this.com as any).sections as Map<string, COMSection>;
    for (const section of sections.values()) {
      sectionsMap.set(section.id, section);
    }

    // Collect formatted text parts (we'll join them into a single block)
    const textParts: string[] = [];

    for (const item of sorted) {
      if (item.type === "section" && item.sectionId) {
        const section = sectionsMap.get(item.sectionId);
        if (section) {
          // Use section's renderer if specified, otherwise default
          const renderer = section.renderer || this.defaultRenderer;

          // Build section text with title as header
          const sectionParts: string[] = [];

          if (section.title) {
            sectionParts.push(`## ${section.title}`);
          }

          // Format section content
          if (Array.isArray(section.content)) {
            const formatted = renderer.format(section.content as SemanticContentBlock[]);
            const text = formatted
              .filter((b): b is { type: "text"; text: string } => b.type === "text")
              .map((b) => b.text)
              .join("\n");
            if (text) sectionParts.push(text);
          } else if (typeof section.content === "string") {
            sectionParts.push(section.content);
          }

          if (sectionParts.length > 0) {
            textParts.push(sectionParts.join("\n"));
          }
        }
      } else if (item.type === "message" && item.content) {
        // Use message's renderer if specified, otherwise default
        const renderer = item.renderer || this.defaultRenderer;
        // Format message content
        const formatted = renderer.format(item.content);
        const text = formatted
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (text) textParts.push(text);
      } else if (item.type === "loose" && item.content) {
        // Use message's renderer if specified, otherwise default
        const renderer = item.renderer || this.defaultRenderer;
        // Format loose content
        const formatted = renderer.format(item.content);
        const text = formatted
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (text) textParts.push(text);
      }
    }

    if (textParts.length > 0) {
      // Create a single, well-formatted text block
      const consolidatedText = textParts.join("\n\n");

      this.com.addMessage({
        role: "system",
        content: [{ type: "text", text: consolidatedText }],
      });
    }
  }

  /**
   * Formats COMInput for model input.
   *
   * Rules:
   * - Sections: Use cached formattedContent
   * - Timeline entries:
   *   - If renderer explicitly set → format using that renderer
   *   - If blocks have semanticNode → format using default renderer (MarkdownRenderer)
   *   - If blocks are event blocks → format using default renderer (event blocks need text conversion)
   *   - Otherwise → preserve ContentBlocks as-is (already formatted from model)
   */
  formatInput(comInput: COMInput): COMInput {
    const formattedTimeline: COMTimelineEntry[] = [];
    const formattedSections: Record<string, COMSection> = {};

    // Format timeline entries
    for (const entry of comInput.timeline) {
      // Check metadata for renderer reference (stored during applyTimelineEntry)
      const explicitRenderer = entry.metadata?.["renderer"] as ContentRenderer | undefined;
      const content = entry.message.content as SemanticContentBlock[];

      // Format if renderer explicitly set OR blocks have semanticNode OR blocks are event blocks
      // Code/json blocks are passed through as-is (they'll be formatted to markdown later in fromEngineState/adapter)
      // Native ContentBlocks (like image/audio/video/code/json) should pass through unchanged
      const hasSemanticNodes = content.some((block) => block.semanticNode || block.semantic);
      const hasEventBlocks = content.some(
        (block) =>
          block.type === "user_action" ||
          block.type === "system_event" ||
          block.type === "state_change",
      );

      let formattedContent: ContentBlock[];
      if (explicitRenderer || hasSemanticNodes || hasEventBlocks) {
        const renderer = explicitRenderer || this.defaultRenderer;
        formattedContent = renderer.format(content);
      } else {
        // Pass through native ContentBlocks as-is (code, json, image, audio, video, etc.)
        formattedContent = content;
      }

      formattedTimeline.push({
        ...entry,
        message: {
          ...entry.message,
          content: formattedContent,
        },
      });
    }

    // Format sections (use cached formattedContent)
    for (const [id, section] of Object.entries(comInput.sections)) {
      if (section.formattedContent) {
        // Use cached formatted content
        formattedSections[id] = {
          ...section,
          content: section.formattedContent,
          // Remove formatting metadata from output
          formattedContent: undefined,
          formattedWith: undefined,
        };
      } else {
        // Fallback: format now (shouldn't happen if applySection worked correctly)
        const renderer = this.defaultRenderer;
        if (Array.isArray(section.content)) {
          const formattedContent = renderer.format(section.content as SemanticContentBlock[]);
          formattedSections[id] = {
            ...section,
            content: formattedContent,
          };
        } else {
          formattedSections[id] = section;
        }
      }
    }

    return {
      timeline: formattedTimeline,
      sections: formattedSections,
      tools: comInput.tools,
      ephemeral: comInput.ephemeral, // Pass through ephemeral (already formatted)
      system: comInput.system,
      metadata: comInput.metadata,
      modelOptions: comInput.modelOptions, // Pass through model options (temperature, maxTokens, etc.)
    };
  }
}
