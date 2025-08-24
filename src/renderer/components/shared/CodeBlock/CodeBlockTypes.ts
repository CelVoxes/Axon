export type CodeBlockVariant = 
  | 'expandable'    // Full featured expandable code block
  | 'inline'        // Simple inline code span
  | 'chat'          // Chat message code blocks
  | 'streaming'     // Live streaming code with auto-scroll
  | 'diff'          // Diff viewer with collapsible sections

export interface CodeBlockBaseProps {
  code: string;
  language?: string;
  className?: string;
}

export interface CodeBlockExpandableProps extends CodeBlockBaseProps {
  variant: 'expandable';
  title?: string;
  isStreaming?: boolean;
  showCopyButton?: boolean;
  showLineNumbers?: boolean;
  maxHeight?: number;
}

export interface CodeBlockInlineProps extends CodeBlockBaseProps {
  variant: 'inline';
}

export interface CodeBlockChatProps extends CodeBlockBaseProps {
  variant: 'chat';
  title?: string;
  isStreaming?: boolean;
}

export interface CodeBlockStreamingProps extends CodeBlockBaseProps {
  variant: 'streaming';
  onStreamingComplete?: () => void;
  autoScroll?: boolean;
}

export interface CodeBlockDiffProps extends CodeBlockBaseProps {
  variant: 'diff';
  title?: string;
  showStats?: boolean;
}

export type CodeBlockProps = 
  | CodeBlockExpandableProps
  | CodeBlockInlineProps  
  | CodeBlockChatProps
  | CodeBlockStreamingProps
  | CodeBlockDiffProps;

export interface DiffLine {
  text: string;
  type: 'added' | 'removed' | 'unchanged' | 'hunk' | 'meta';
  lineNumber?: number;
}

export interface DiffSegment {
  type: 'line' | 'collapsed';
  id?: number;
  count?: number;
  lines?: DiffLine[];
  content?: DiffLine;
}

export interface CodeBlockStyleProps {
  $variant: CodeBlockVariant;
  $isStreaming?: boolean;
  $hasContent?: boolean;
  $maxHeight?: number;
}