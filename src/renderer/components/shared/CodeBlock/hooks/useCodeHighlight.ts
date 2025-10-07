import { useEffect, useMemo, useRef } from 'react';
import hljs from 'highlight.js';
import { resolveHighlightLanguage } from '../../../../utils/highlight';

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
  enabled = true,
}: UseCodeHighlightProps) {
  const codeRef = useRef<HTMLElement | null>(null);
  const didInitialHighlightRef = useRef<boolean>(false);
  const { language: highlightLanguage, didFallback } = useMemo(
    () => resolveHighlightLanguage(language),
    [language]
  );

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
          el.className = `hljs language-${highlightLanguage}`;
          el.removeAttribute('data-highlighted');
          if (didFallback && language) {
            el.setAttribute('data-language-fallback', language);
          } else {
            el.removeAttribute('data-language-fallback');
          }
          hljs.highlightElement(el);
        } catch (error) {
          console.warn('Highlight.js error:', error);
        }
      });
    }, 50); // Small delay to batch rapid updates

    return () => clearTimeout(timeoutId);
  }, [code, highlightLanguage, didFallback, language, isStreaming, enabled]);

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
    if (code.length > 10) {
      try {
        el.textContent = code;
        el.className = `hljs language-${highlightLanguage}`;
        el.removeAttribute('data-highlighted');
        if (didFallback && language) {
          el.setAttribute('data-language-fallback', language);
        } else {
          el.removeAttribute('data-language-fallback');
        }
        hljs.highlightElement(el);
        didInitialHighlightRef.current = true;
      } catch (error) {
        console.warn('Initial highlight error:', error);
      }
    }
  }, [isStreaming, code, highlightLanguage, didFallback, language, enabled]);

  return { codeRef };
}
