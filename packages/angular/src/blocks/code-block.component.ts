import { Component, Input } from "@angular/core";
import type { CodeBlock } from "aidk-client";

@Component({
  selector: "aidk-code-block",
  standalone: true,
  template: `
    <div>
      @if (block.language) {
        <div style="font-size: 0.75rem; color: #666; margin-bottom: 4px; font-family: monospace;">
          {{ block.language }}
        </div>
      }
      <pre style="background-color: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow: auto; font-size: 0.875rem; margin: 0;">
        <code>{{ block.text }}</code>
      </pre>
    </div>
  `,
})
export class CodeBlockComponent {
  @Input() block!: CodeBlock;
}
