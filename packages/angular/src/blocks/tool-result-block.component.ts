import { Component, Input } from '@angular/core';
import type { ToolResultBlock } from 'aidk-client';

@Component({
  selector: 'aidk-tool-result-block',
  standalone: true,
  template: `
    <div [style]="containerStyle">
      <span>{{ block.is_error ? '❌' : '✅' }}</span>
      <span>Tool result{{ executedBy }}</span>
    </div>
  `,
})
export class ToolResultBlockComponent {
  @Input() block!: ToolResultBlock;

  get executedBy(): string {
    return this.block.executed_by ? ` (${this.block.executed_by})` : '';
  }

  get containerStyle(): string {
    const bg = this.block.is_error ? '#fff0f0' : '#f0fff0';
    const color = this.block.is_error ? '#c00' : '#080';
    return `display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background-color: ${bg}; border-radius: 4px; font-size: 0.875rem; color: ${color};`;
  }
}

