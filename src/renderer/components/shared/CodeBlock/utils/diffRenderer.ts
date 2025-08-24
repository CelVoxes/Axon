import type { DiffLine, DiffSegment } from '../CodeBlockTypes';

export function parseDiffContent(code: string): DiffSegment[] {
  const lines = code.split(/\r?\n/);
  
  const classifyLine = (line: string): DiffLine => {
    if (line.startsWith('+++ ') || line.startsWith('--- ') || 
        line.startsWith('diff ') || line.startsWith('index ')) {
      return { text: line, type: 'meta' };
    }
    
    if (line.startsWith('@@')) {
      return { text: line, type: 'hunk' };
    }
    
    if (line.startsWith('+') && !line.startsWith('+++ ')) {
      return { text: line, type: 'added' };
    }
    
    if (line.startsWith('-') && !line.startsWith('--- ')) {
      return { text: line, type: 'removed' };
    }
    
    return { text: line, type: 'unchanged' };
  };

  const classifiedLines = lines.map(classifyLine);
  
  // Find important lines (additions, deletions, hunks, meta)
  const importantIndices: number[] = [];
  classifiedLines.forEach((line, index) => {
    if (['added', 'removed', 'hunk', 'meta'].includes(line.type)) {
      importantIndices.push(index);
    }
  });

  // If no important lines, return all as regular lines
  if (importantIndices.length === 0) {
    return classifiedLines.map(line => ({
      type: 'line',
      content: line
    }));
  }

  const segments: DiffSegment[] = [];
  let cursor = 0;
  let segmentId = 0;

  for (const importantIndex of importantIndices) {
    // Add collapsed segment for unchanged lines before this important line
    if (importantIndex > cursor) {
      const unchangedLines = classifiedLines.slice(cursor, importantIndex);
      if (unchangedLines.length > 0) {
        segments.push({
          type: 'collapsed',
          id: segmentId++,
          count: unchangedLines.length,
          lines: unchangedLines
        });
      }
    }

    // Add the important line
    segments.push({
      type: 'line',
      content: classifiedLines[importantIndex]
    });

    cursor = importantIndex + 1;
  }

  // Add remaining unchanged lines as collapsed segment
  if (cursor < classifiedLines.length) {
    const remainingLines = classifiedLines.slice(cursor);
    if (remainingLines.length > 0) {
      segments.push({
        type: 'collapsed',
        id: segmentId++,
        count: remainingLines.length,
        lines: remainingLines
      });
    }
  }

  return segments;
}

export function getDiffStats(code: string): { additions: number; deletions: number } {
  const lines = code.split(/\r?\n/);
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  return { additions, deletions };
}