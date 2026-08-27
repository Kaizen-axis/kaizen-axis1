import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function ScrollTabBar({
  children,
  className = '',
  trackClassName = 'gap-2',
  prevLabel = 'Abas anteriores',
  nextLabel = 'Próximas abas',
  scrollStep,
}: {
  children: ReactNode;
  className?: string;
  trackClassName?: string;
  prevLabel?: string;
  nextLabel?: string;
  scrollStep?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < maxScroll - 4);
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
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const step = scrollStep ?? Math.min(el.clientWidth * 0.55, 200);
    const next = Math.min(maxScroll, Math.max(0, el.scrollLeft + direction * step));
    el.scrollTo({ left: next, behavior: 'smooth' });
  };

  const arrowClass =
    'shrink-0 h-11 w-11 rounded-full bg-card-bg border border-surface-200 shadow-md flex items-center justify-center text-text-secondary disabled:opacity-30';

  return (
    <div className={`flex items-center min-w-0 gap-1 ${className}`}>
      <button
        type="button"
        aria-label={prevLabel}
        disabled={!canScrollLeft}
        onClick={() => scrollByPage(-1)}
        className={arrowClass}
      >
        <ChevronLeft size={18} />
      </button>
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className={`min-w-0 flex-1 flex flex-nowrap overflow-x-auto no-scrollbar overscroll-x-none touch-pan-x ${trackClassName}`}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={nextLabel}
        disabled={!canScrollRight}
        onClick={() => scrollByPage(1)}
        className={arrowClass}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
