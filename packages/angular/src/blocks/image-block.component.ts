import { Component, Input } from '@angular/core';
import type { GeneratedImageBlock, ImageBlock } from 'aidk-client';

@Component({
  selector: 'aidk-image-block',
  standalone: true,
  template: `
    @if (src) {
      <img [src]="src" [alt]="block.alt_text || 'Image'" style="max-width: 100%; height: auto; border-radius: 4px;" />
    } @else {
      <div>[Image: unsupported source type]</div>
    }
  `,
})
export class ImageBlockComponent {
  @Input() block!: ImageBlock | GeneratedImageBlock;

  get src(): string | undefined {
    if (this.block.type === 'generated_image') {
      return this.block.data;
    }
    if (this.block.source.type === 'url') {
      return this.block.source.url;
    }
    if (this.block.source.type === 'base64') {
      const mimeType = this.block.mime_type || 'image/png';
      return `data:${mimeType};base64,${this.block.source.data}`;
    }
    return undefined;
  }
}

