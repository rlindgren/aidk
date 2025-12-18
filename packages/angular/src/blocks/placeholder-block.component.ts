import { Component, Input } from '@angular/core';
import type { ContentBlock } from 'aidk-client';

@Component({
  selector: 'aidk-placeholder-block',
  standalone: true,
  template: `
    <div style="padding: 8px 12px; background-color: #f5f5f5; border-radius: 4px; font-size: 0.875rem; color: #666; font-style: italic;">
      [{{ block.type }} block]
    </div>
  `,
})
export class PlaceholderBlockComponent {
  @Input() block!: ContentBlock;
}

