import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function ScrollTabBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    window.addEventListener('resize', updateScrollState);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [children, updateScrollState]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const arrowClass =
    'absolute top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-card-bg border border-surface-200 shadow-md flex items-center justify-center text-text-secondary disabled:opacity-30';

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-label="Abas anteriores"
        disabled={!canScrollLeft}
        onClick={() => scrollByPage(-1)}
        className={`${arrowClass} left-0`}
      >
        <ChevronLeft size={18} />
      </button>
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar overscroll-x-contain px-11 touch-pan-x"
      >
        {children}
      </div>
      <button
        type="button"
        aria-label="Próximas abas"
        disabled={!canScrollRight}
        onClick={() => scrollByPage(1)}
        className={`${arrowClass} right-0`}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
