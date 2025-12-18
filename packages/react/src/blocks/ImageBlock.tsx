import type { GeneratedImageBlock, ImageBlock as ImageBlockType } from 'aidk-client';

interface Props {
  block: ImageBlockType | GeneratedImageBlock;
  className?: string;
}

export function ImageBlock({ block, className }: Props) {
  let src: string | undefined;
  
  if (block.type === 'generated_image') {
    src = block.data;
  } else {
    if (block.source.type === 'url') {
      src = block.source.url;
    } else if (block.source.type === 'base64') {
      const mimeType = block.mime_type || 'image/png';
      src = `data:${mimeType};base64,${block.source.data}`;
    }
  }

  if (!src) {
    return <div className={className}>[Image: unsupported source type]</div>;
  }

  return (
    <img
      src={src}
      alt={block.alt_text || 'Image'}
      className={className}
      style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
    />
  );
}

