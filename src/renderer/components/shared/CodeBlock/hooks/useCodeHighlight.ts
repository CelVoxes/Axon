import { useEffect, useRef } from 'react';
import hljs from 'highlight.js';

interface UseCodeHighlightProps {
  code: string;
  language: string;
  isStreaming?: boolean;
  enabled?: boolean;
}

export function useCodeHighlight({
  code,
  language,
  isStreaming = false,
  enabled = true
}: UseCodeHighlightProps) {
  const codeRef = useRef<HTMLElement | null>(null);
  const didInitialHighlightRef = useRef<boolean>(false);

  // Highlight code when content changes; skip during streaming to avoid performance issues
  useEffect(() => {
    if (!enabled || isStreaming) return;
    
    const el = codeRef.current;
    if (!el || !code) return;

    // Debounce highlighting for better performance
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        try {
          // Always reset to plain text to avoid leftover spans
          el.textContent = code;
          el.className = `hljs language-${language}`;
          el.removeAttribute('data-highlighted');
          hljs.highlightElement(el);
        } catch (error) {
          console.warn('Highlight.js error:', error);
        }
      });
    }, 50); // Small delay to batch rapid updates
    
    return () => clearTimeout(timeoutId);
  }, [code, language, isStreaming, enabled]);

  // One-time initial highlight when first content arrives during streaming
  useEffect(() => {
    if (!enabled || !isStreaming) {
      didInitialHighlightRef.current = false;
      return;
    }
    
    if (!code || code.length === 0) return;
    if (didInitialHighlightRef.current) return;
    
    const el = codeRef.current;
    if (!el) return;
    
    // Only highlight once when streaming starts with first meaningful content
    if (code.length > 10) { // Wait for substantial content
      try {
        el.textContent = code;
        el.className = `hljs language-${language}`;
        el.removeAttribute('data-highlighted');
        hljs.highlightElement(el);
        didInitialHighlightRef.current = true;
      } catch (error) {
        console.warn('Initial highlight error:', error);
      }
    }
  }, [isStreaming, code, language, enabled]);

  return { codeRef };
}