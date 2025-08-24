import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface UseCodeStreamingProps {
  isStreaming: boolean;
  code: string;
  autoScroll?: boolean;
  onStreamingComplete?: () => void;
}

export function useCodeStreaming({
  isStreaming,
  code,
  autoScroll = true,
  onStreamingComplete
}: UseCodeStreamingProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const lastScrollHeightRef = useRef<number>(0);
  const [isScrollPaused, setIsScrollPaused] = useState(false);

  // Enable auto-scroll when streaming starts
  useEffect(() => {
    if (isStreaming && autoScroll) {
      autoScrollRef.current = true;
      setIsScrollPaused(false);
    }
  }, [isStreaming, autoScroll]);

  // Track scroll position to pause auto-scroll when user scrolls up
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !autoScroll) return;

    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      autoScrollRef.current = nearBottom;
      setIsScrollPaused(!nearBottom);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [autoScroll]);

  // Auto-scroll on content growth during streaming
  useLayoutEffect(() => {
    if (!autoScroll) return;
    
    const el = scrollContainerRef.current;
    if (!el) return;

    const newHeight = el.scrollHeight;
    
    if (isStreaming) {
      if (autoScrollRef.current && newHeight > (lastScrollHeightRef.current || 0)) {
        el.scrollTop = newHeight;
      }
      lastScrollHeightRef.current = newHeight;
    } else if (autoScrollRef.current) {
      // Final scroll to bottom when streaming completes
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
        lastScrollHeightRef.current = el.scrollHeight;
      });
    }
  }, [code, isStreaming, autoScroll]);

  // Call completion callback when streaming stops
  useEffect(() => {
    if (!isStreaming && onStreamingComplete) {
      onStreamingComplete();
    }
  }, [isStreaming, onStreamingComplete]);

  return {
    scrollContainerRef,
    isScrollPaused
  };
}