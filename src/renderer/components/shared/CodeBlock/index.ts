// Main exports
export { CodeBlock } from './CodeBlock';
export type { CodeBlockProps, CodeBlockVariant } from './CodeBlockTypes';

// Individual variant exports for specific use cases
export {
  InlineCodeBlock,
  ChatCodeBlock,
  ExpandableCodeBlock, 
  StreamingCodeBlock,
  DiffCodeBlock
} from './CodeBlock';

// Utility exports
export { parseDiffContent, getDiffStats } from './utils/diffRenderer';

// Hook exports for advanced usage
export { useCodeHighlight } from './hooks/useCodeHighlight';
export { useCodeStreaming } from './hooks/useCodeStreaming';