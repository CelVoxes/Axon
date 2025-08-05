/**
 * Event handling hooks to eliminate 25+ addEventListener duplications
 */
import { useEffect, useCallback, useRef } from 'react';

/**
 * Window event listener hook - eliminates duplicate addEventListener patterns
 */
export function useWindowEvent<K extends keyof WindowEventMap>(
  eventType: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler = (event: WindowEventMap[K]) => {
      handlerRef.current(event);
    };

    window.addEventListener(eventType, wrappedHandler, options);
    return () => window.removeEventListener(eventType, wrappedHandler, options);
  }, [eventType, options]);
}

/**
 * Document event listener hook
 */
export function useDocumentEvent<K extends keyof DocumentEventMap>(
  eventType: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler = (event: DocumentEventMap[K]) => {
      handlerRef.current(event);
    };

    document.addEventListener(eventType, wrappedHandler, options);
    return () => document.removeEventListener(eventType, wrappedHandler, options);
  }, [eventType, options]);
}

/**
 * Element event listener hook
 */
export function useElementEvent<T extends Element, K extends keyof ElementEventMap>(
  element: T | null,
  eventType: K,
  handler: (event: ElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!element) return;

    const wrappedHandler = (event: ElementEventMap[K]) => {
      handlerRef.current(event);
    };

    element.addEventListener(eventType, wrappedHandler, options);
    return () => element.removeEventListener(eventType, wrappedHandler, options);
  }, [element, eventType, options]);
}

/**
 * Keyboard event hook - consolidates common keyboard patterns
 */
export function useKeyboardShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }
) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key !== key) return;
    
    const { ctrl = false, shift = false, alt = false, meta = false } = modifiers || {};
    
    if (
      event.ctrlKey === ctrl &&
      event.shiftKey === shift &&
      event.altKey === alt &&
      event.metaKey === meta
    ) {
      handler(event);
    }
  }, [key, handler, modifiers]);

  useWindowEvent('keydown', handleKeyDown);
}

/**
 * Click outside hook - consolidates modal/dropdown close patterns
 */
export function useClickOutside<T extends HTMLElement>(
  handler: () => void
) {
  const ref = useRef<T>(null);

  const handleClick = useCallback((event: MouseEvent) => {
    if (ref.current && !ref.current.contains(event.target as Node)) {
      handler();
    }
  }, [handler]);

  useDocumentEvent('mousedown', handleClick);

  return ref;
}

/**
 * Window resize hook - consolidates resize listeners
 */
export function useWindowResize(
  handler: (size: { width: number; height: number }) => void,
  debounceMs: number = 100
) {
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleResize = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      handler({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }, debounceMs);
  }, [handler, debounceMs]);

  useWindowEvent('resize', handleResize);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
}

/**
 * Scroll hook - consolidates scroll listeners
 */
export function useScroll(
  handler: (scrollData: { scrollY: number; scrollX: number }) => void,
  element?: Element | null,
  throttleMs: number = 16 // ~60fps
) {
  const lastCallRef = useRef(0);

  const handleScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastCallRef.current >= throttleMs) {
      lastCallRef.current = now;
      
      if (element) {
        handler({
          scrollY: element.scrollTop,
          scrollX: element.scrollLeft,
        });
      } else {
        handler({
          scrollY: window.scrollY,
          scrollX: window.scrollX,
        });
      }
    }
  }, [handler, element, throttleMs]);

  useEffect(() => {
    if (element) {
      element.addEventListener('scroll', handleScroll);
      return () => element.removeEventListener('scroll', handleScroll);
    } else {
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
    }
  }, [element, handleScroll]);
}

/**
 * Multi-event hook - for handling multiple events with same handler
 */
export function useMultipleEvents<T extends Element>(
  element: T | null,
  events: string[],
  handler: (event: Event) => void,
  options?: boolean | AddEventListenerOptions
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!element) return;

    const wrappedHandler = (event: Event) => {
      handlerRef.current(event);
    };

    events.forEach(eventType => {
      element.addEventListener(eventType, wrappedHandler, options);
    });

    return () => {
      events.forEach(eventType => {
        element.removeEventListener(eventType, wrappedHandler, options);
      });
    };
  }, [element, events, options]);
}