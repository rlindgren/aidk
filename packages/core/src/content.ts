// Re-export content types, but exclude ones we extend locally
// Note: Message, ContentBlock, etc. are also exported from types.ts re-exports
export {
  normalizeMessageInput,
  normalizeContentInput,
  normalizeContentArray,
  isMessage,
  isContentBlock,
} from 'aidk-shared';
export * from 'aidk-shared/blocks';
export * from 'aidk-shared/block-types';
export * from 'aidk-shared/streaming';
export * from 'aidk-shared/input';
export * from 'aidk-shared/messages';