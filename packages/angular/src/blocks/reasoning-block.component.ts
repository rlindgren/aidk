import { Component, Input } from '@angular/core';
import type { ReasoningBlock } from 'aidk-client';
import { TextBlockComponent } from './text-block.component';

@Component({
  selector: 'aidk-reasoning-block',
  standalone: true,
  imports: [
    TextBlockComponent,
  ],
  template: `
    @if (block.isRedacted) {
      <div style="color: #666; font-style: italic;">[Reasoning redacted]</div>
    } @else {
      <div>
        <button
          (click)="expanded = !expanded"
          style="background: none; border: none; cursor: pointer; padding: 4px 8px; display: flex; align-items: center; gap: 4px; color: #666; font-size: 0.875rem;"
        >
          <span [style.transform]="expanded ? 'rotate(90deg)' : 'rotate(0)'" style="transition: transform 0.2s;">▶</span>
          <span>Thinking...</span>
        </button>
        @if (expanded) {
          <div style="margin-top: 8px; padding: 12px; background-color:rgba(0, 0, 0, 0.25); border-radius: 4px; font-size: 0.875rem; color:rgba(255, 255, 255, 0.42);">
            <aidk-text-block [block]="block" />
          </div>
        }
      </div>
    }
  `,
})
export class ReasoningBlockComponent {
  @Input() block!: ReasoningBlock;
  expanded = false;
}

