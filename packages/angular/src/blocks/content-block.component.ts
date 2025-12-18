import { Component, Input } from '@angular/core';
import type { ContentBlock } from 'aidk-client';
import { TextBlockComponent } from './text-block.component';
import { ReasoningBlockComponent } from './reasoning-block.component';
import { ToolUseBlockComponent } from './tool-use-block.component';
import { ToolResultBlockComponent } from './tool-result-block.component';
import { ImageBlockComponent } from './image-block.component';
import { CodeBlockComponent } from './code-block.component';
import { PlaceholderBlockComponent } from './placeholder-block.component';

@Component({
  selector: 'aidk-content-block',
  standalone: true,
  imports: [
    TextBlockComponent,
    ReasoningBlockComponent,
    ToolUseBlockComponent,
    ToolResultBlockComponent,
    ImageBlockComponent,
    CodeBlockComponent,
    PlaceholderBlockComponent,
  ],
  template: `
    @switch (block.type) {
      @case ('text') {
        <aidk-text-block [block]="$any(block)" />
      }
      @case ('reasoning') {
        <aidk-reasoning-block [block]="$any(block)" />
      }
      @case ('tool_use') {
        <aidk-tool-use-block [block]="$any(block)" />
      }
      @case ('tool_result') {
        <aidk-tool-result-block [block]="$any(block)" />
      }
      @case ('image') {
        <aidk-image-block [block]="$any(block)" />
      }
      @case ('generated_image') {
        <aidk-image-block [block]="toImageBlock($any(block))" />
      }
      @case ('code') {
        <aidk-code-block [block]="$any(block)" />
      }
      @case ('json') {
        <aidk-code-block [block]="toCodeBlock($any(block), 'json')" />
      }
      @case ('executable_code') {
        <aidk-code-block [block]="executableToCodeBlock($any(block))" />
      }
      @case ('code_execution_result') {
        <div>
          <div [style.font-size]="'0.75rem'" [style.color]="$any(block).is_error ? '#c00' : '#666'" style="margin-bottom: 4px;">
            {{ $any(block).is_error ? '❌ Execution Error' : '✅ Output' }}
          </div>
          <pre [style.background-color]="'#1e1e1e'" [style.color]="$any(block).is_error ? '#f88' : '#d4d4d4'" style="padding: 12px; border-radius: 4px; overflow: auto; font-size: 0.875rem; margin: 0;">{{ $any(block).output }}</pre>
        </div>
      }
      @default {
        <aidk-placeholder-block [block]="block" />
      }
    }
  `,
})
export class ContentBlockComponent {
  @Input() block!: ContentBlock;

  toImageBlock(block: any) {
    return {
      ...block,
      type: 'image',
      source: { type: 'base64', data: block.data },
    };
  }

  toCodeBlock(block: any, language: string) {
    return { ...block, type: 'code', language };
  }

  executableToCodeBlock(block: any) {
    return {
      ...block,
      type: 'code',
      text: block.code,
      language: block.language || 'code',
    };
  }
}

