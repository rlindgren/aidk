import { Component, Input } from '@angular/core';
import type { OnChanges, SimpleChanges } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import type { TextBlock, ReasoningBlock } from 'aidk-client';

/**
 * TextBlock component - renders markdown text content.
 * 
 * This is a style-less component. To add styling, either:
 * 1. Import the provided CSS: `@import 'aidk-angular/dist/markdown.css'`
 * 2. Add your own styles targeting `.aidk-markdown` class
 * 3. Use ViewEncapsulation.None and add global styles
 */
@Component({
  selector: 'aidk-text-block',
  standalone: true,
  template: `<div class="aidk-markdown" [innerHTML]="renderedHtml"></div>`,
})
export class TextBlockComponent implements OnChanges {
  @Input() block!: TextBlock | ReasoningBlock;
  
  renderedHtml: SafeHtml = '';

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['block'] && this.block) {
      // marked.parse() is synchronous in v17
      const html = typeof marked.parse === 'function' 
        ? marked.parse(this.block.text, { breaks: true, gfm: true })
        : marked(this.block.text, { breaks: true, gfm: true });
      
      this.renderedHtml = this.sanitizer.bypassSecurityTrustHtml(html as string);
    }
  }
}
