/**
 * Sanitize markdown content before rendering.
 * - Removes empty blockquote lines (">" with no text) that render as empty blue bars.
 * - Collapses excessive blank lines.
 */
export function sanitizeMarkdown(input: string): string {
  if (!input) return input;

  let s = input;

  // Remove lines that are only a blockquote marker with optional whitespace
  // This prevents rendering a lone blue quotation bar with no content.
  s = s.replace(/^[ \t]*>\s*$/gm, "");

  // Collapse 2+ consecutive newlines to exactly 2, ensuring a single blank line between paragraphs
  s = s.replace(/\n{2,}/g, "\n\n");

  // Avoid trailing whitespace-only lines
  return s.replace(/[ \t]+$/gm, "");
}
