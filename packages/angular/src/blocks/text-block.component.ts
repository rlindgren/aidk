import { Component, Input } from "@angular/core";
import type { TextBlock, ReasoningBlock } from "aidk-client";

/**
 * TextBlock component - displays text content from AI responses.
 *
 * This component provides the raw text and lets you handle rendering.
 * For markdown rendering, provide your rendered content via ng-content
 * or use the `renderedHtml` input for pre-rendered HTML.
 *
 * This decoupled approach gives you control over:
 * - Which markdown library to use (ngx-markdown, marked, etc.)
 * - Sanitization (DOMPurify, Angular's built-in, etc.)
 * - Custom styling and components
 *
 * @example Plain text (default)
 * ```html
 * <aidk-text-block [block]="block"></aidk-text-block>
 * ```
 *
 * @example With ngx-markdown
 * ```html
 * <aidk-text-block [block]="block">
 *   <markdown [data]="block.text"></markdown>
 * </aidk-text-block>
 * ```
 *
 * @example With pre-rendered HTML (sanitize first!)
 * ```html
 * <aidk-text-block [block]="block" [renderedHtml]="sanitizedHtml">
 * </aidk-text-block>
 * ```
 *
 * @example Access raw text in parent
 * ```typescript
 * // In your component
 * renderMarkdown(text: string): SafeHtml {
 *   const html = marked.parse(text);
 *   return this.sanitizer.bypassSecurityTrustHtml(DOMPurify.sanitize(html));
 * }
 * ```
 */
@Component({
  selector: "aidk-text-block",
  standalone: true,
  template: `
    <div [class]="className">
      <ng-content></ng-content>
      @if (renderedHtml) {
        <div [innerHTML]="renderedHtml"></div>
      } @else if (!hasProjectedContent) {
        {{ block.text }}
      }
    </div>
  `,
})
export class TextBlockComponent {
  @Input() block!: TextBlock | ReasoningBlock;
  @Input() className?: string;

  /**
   * Pre-rendered HTML content. If provided, renders this instead of plain text.
   * IMPORTANT: Ensure this is sanitized before passing (e.g., via DOMPurify).
   */
  @Input() renderedHtml?: string;

  /**
   * Set to true if you're providing content via ng-content.
   * This prevents the plain text fallback from showing.
   */
  @Input() hasProjectedContent = false;
}
