import { Component, Input } from '@angular/core';
import type { ToolUseBlock } from 'aidk-client';

@Component({
  selector: 'aidk-tool-use-block',
  standalone: true,
  template: `
    <div style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background-color: #f0f0f0; border-radius: 4px; font-size: 0.875rem; color: #555;">
      <span>🔧</span>
      <span style="font-weight: 500;">{{ block.name }}</span>
      <span style="color: #888;">— {{ inputSummary }}</span>
      @if (block.tool_result) {
        <span style="display: flex; flex: 1; justify-content: flex-end;">{{ block.tool_result.is_error ? '❌' : '✅' }}</span>
      } @else {
        <span style="display: flex; flex: 1; justify-content: flex-end;">⏳</span>
      }
    </div>
  `,
})
export class ToolUseBlockComponent {
  @Input() block!: ToolUseBlock;

  get inputSummary(): string {
    const keys = Object.keys(this.block.input || {});
    return keys.length > 0 
      ? `${keys.length} field${keys.length > 1 ? 's' : ''}`
      : 'no input';
  }
}

