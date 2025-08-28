import { ToolRegistry } from "./ToolRegistry";
// Ensure tools are registered
import "./ChatToolService";

interface InspectionResult {
  path: string;
  content?: string;
  language?: string;
  title?: string;
  success: boolean;
  error?: string;
}

/**
 * Service for autonomous file/folder inspection based on user messages.
 * Automatically peeks at mentioned files/folders to provide context before code execution.
 */
export class AutonomousInspectionService {
  private toolRegistry: ToolRegistry;
  private workspaceDir?: string;

  constructor(workspaceDir?: string) {
    this.toolRegistry = ToolRegistry.getInstance();
    this.workspaceDir = workspaceDir;
  }

  /**
   * Extract file/folder mentions from user message
   */
  private extractMentions(message: string): string[] {
    const patterns = [
      // @file.py or @folder/ syntax
      /@([^\s@]+)/g,
      // Direct file references like "file.py" or "data/file.csv"  
      /(?:^|\s)([a-zA-Z0-9_\-./]+\.(?:py|ipynb|csv|txt|json|md|yml|yaml))\b/g,
      // Directory references like "data/" or "src/"
      /(?:^|\s)([a-zA-Z0-9_\-./]+\/)\b/g,
    ];

    const mentions = new Set<string>();
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const mention = match[1];
        if (mention && !mention.startsWith('.')) { // Skip hidden files
          mentions.add(mention);
        }
      }
    }

    return Array.from(mentions);
  }

  /**
   * Peek at a single file/folder
   */
  private async peekItem(path: string): Promise<InspectionResult> {
    try {
      const peekTool = this.toolRegistry.find("/peek");
      if (!peekTool) {
        return {
          path,
          success: false,
          error: "Peek tool not available"
        };
      }

      const result = await this.toolRegistry.execute(`/peek ${path}`, {
        workspaceDir: this.workspaceDir,
      });

      if (result.ok) {
        return {
          path,
          content: result.code,
          language: result.codeLanguage,
          title: result.title,
          success: true,
        };
      } else {
        return {
          path,
          success: false,
          error: result.message || "Peek failed"
        };
      }
    } catch (error) {
      return {
        path,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Autonomously inspect all mentioned files/folders in a message
   */
  async inspectMentionedItems(
    userMessage: string,
    onItemInspected?: (result: InspectionResult) => void | Promise<void>
  ): Promise<InspectionResult[]> {
    const mentions = this.extractMentions(userMessage);
    if (mentions.length === 0) {
      return [];
    }

    const results: InspectionResult[] = [];

    // Inspect items sequentially for better UX visibility
    for (const mention of mentions) {
      const result = await this.peekItem(mention);
      if (onItemInspected) {
        await onItemInspected(result);
      }
      results.push(result);
    }

    return results;
  }

  /**
   * Get a summary of all inspected content for context building
   */
  buildInspectionContext(results: InspectionResult[]): string {
    const successfulInspections = results.filter(r => r.success);
    if (successfulInspections.length === 0) {
      return "";
    }

    const contextParts = successfulInspections.map(result => {
      let context = `\n--- ${result.path} ---\n`;
      if (result.content) {
        // Truncate very long content to prevent context overflow
        const truncatedContent = result.content.length > 2000 
          ? result.content.slice(0, 2000) + "\n... [truncated]"
          : result.content;
        context += truncatedContent;
      }
      return context;
    });

    return "\n=== WORKSPACE INSPECTION CONTEXT ===\n" + 
           contextParts.join("\n") + 
           "\n=== END INSPECTION CONTEXT ===\n";
  }

  /**
   * Check if message suggests file/folder operations that would benefit from inspection
   */
  shouldInspect(userMessage: string): boolean {
    const inspectionTriggers = [
      // File/folder mentions
      /@[^\s@]+/,
      /\b\w+\.\w+\b/, // filename.ext
      /\b\w+\//,      // directory/
      
      // Intent keywords
      /\b(?:show|view|look|check|inspect|read|open|examine)\b/i,
      /\b(?:file|folder|directory|content|structure)\b/i,
      /\b(?:what'?s in|contents of|inside)\b/i,
      
      // Code-related keywords that might reference files
      /\b(?:import|load|analyze|process|debug)\b/i,
    ];

    return inspectionTriggers.some(pattern => pattern.test(userMessage));
  }
}