import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Client, ClientStage } from '@/data/clients';
import { cn } from '@/lib/utils';

/**
 * Quadro Kanban do pipeline com drag-and-drop por Pointer Events — funciona em
 * desktop (mouse) e mobile/iOS (toque).
 *
 * Mobile: pressione o card (segure ~160ms) e arraste de qualquer parte dele. Ao
 * chegar perto das bordas, o quadro desliza sozinho (suave) revelando as etapas.
 * Toque curto abre a ficha; rolar normalmente continua funcionando.
 */
export function ClientsKanban({
  clients,
  stages,
  onMove,
  renderActions,
  onCardOpen,
}: {
  clients: Client[];
  stages: ClientStage[];
  onMove: (clientId: string, stage: ClientStage) => void;
  renderActions?: (client: Client) => ReactNode;
  onCardOpen?: (client: Client) => void;
}) {
  const navigate = useNavigate();
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghostNameRef = useRef<HTMLParagraphElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const drag = useRef<{
    id: string; stage: string; name: string;
    startX: number; startY: number; pointerType: string; pointerId: number;
    el: HTMLElement; started: boolean; timer: number | null;
  } | null>(null);
  const overStageRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const scrollVel = useRef(0);
  const rafId = useRef<number | null>(null);

  const LONG_PRESS_MS = 160;
  const MOUSE_START = 6;     // mouse: distância p/ iniciar arrasto
  const TOUCH_CANCEL = 12;   // toque: mover além disso antes do long-press = rolar
  const EDGE = 76;           // zona de auto-scroll (px)
  const MAX_SPEED = 24;      // px/frame no limite da borda

  const setOver = (s: string | null) => {
    if (overStageRef.current === s) return; // evita re-render desnecessário
    overStageRef.current = s;
    setOverStage(s);
  };

  const moveGhost = (x: number, y: number) => {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  };

  const refreshOver = () => {
    if (!drag.current) return;
    const { x, y } = pointer.current;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const col = el?.closest('[data-stage]') as HTMLElement | null;
    setOver(col?.getAttribute('data-stage') ?? null);
  };

  const stopAutoScroll = () => {
    scrollVel.current = 0;
    if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  };

  const autoScrollStep = () => {
    const board = boardRef.current;
    if (!drag.current || !board || scrollVel.current === 0) { rafId.current = null; return; }
    const max = board.scrollWidth - board.clientWidth;
    board.scrollLeft = Math.max(0, Math.min(max, board.scrollLeft + scrollVel.current));
    refreshOver();
    rafId.current = requestAnimationFrame(autoScrollStep);
  };

  const evaluateEdge = (x: number) => {
    const board = boardRef.current;
    if (!board) return;
    const r = board.getBoundingClientRect();
    let vel = 0;
    if (x < r.left + EDGE) vel = -Math.min(1, (r.left + EDGE - x) / EDGE) * MAX_SPEED;
    else if (x > r.right - EDGE) vel = Math.min(1, (x - (r.right - EDGE)) / EDGE) * MAX_SPEED;
    scrollVel.current = vel;
    if (vel !== 0 && rafId.current == null) rafId.current = requestAnimationFrame(autoScrollStep);
    else if (vel === 0) stopAutoScroll();
  };

  const startDrag = () => {
    const info = drag.current;
    if (!info || info.started) return;
    info.started = true;
    draggingRef.current = true;
    setDragId(info.id);
    try { info.el.setPointerCapture(info.pointerId); } catch { /* noop */ }
    if (ghostNameRef.current) ghostNameRef.current.textContent = info.name;
    if (ghostRef.current) ghostRef.current.style.display = 'block';
    moveGhost(pointer.current.x, pointer.current.y);
    refreshOver();
    if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* noop */ }
  };

  const cleanup = () => {
    if (drag.current?.timer) window.clearTimeout(drag.current.timer);
    stopAutoScroll();
    drag.current = null;
    draggingRef.current = false;
    if (ghostRef.current) ghostRef.current.style.display = 'none';
    setDragId(null);
    setOver(null);
  };

  // Bloqueia o scroll nativo apenas enquanto arrasta (touchmove não-passivo)
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const block = (e: TouchEvent) => { if (draggingRef.current) e.preventDefault(); };
    board.addEventListener('touchmove', block, { passive: false });
    return () => board.removeEventListener('touchmove', block);
  }, []);

  const onPointerDown = (e: React.PointerEvent, c: Client) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = {
      id: c.id, stage: c.stage, name: c.name,
      startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, pointerId: e.pointerId,
      el: e.currentTarget as HTMLElement, started: false, timer: null,
    };
    pointer.current = { x: e.clientX, y: e.clientY };
    if (e.pointerType !== 'mouse') {
      drag.current.timer = window.setTimeout(startDrag, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const info = drag.current;
    if (!info) return;
    pointer.current = { x: e.clientX, y: e.clientY };

    if (!info.started) {
      const dist = Math.hypot(e.clientX - info.startX, e.clientY - info.startY);
      if (info.pointerType === 'mouse') {
        if (dist > MOUSE_START) startDrag();
      } else if (dist > TOUCH_CANCEL) {
        // mexeu antes do long-press → intenção de rolar: cancela o arrasto
        if (info.timer) window.clearTimeout(info.timer);
        drag.current = null;
      }
      return;
    }

    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    refreshOver();
    evaluateEdge(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const info = drag.current;
    if (!info) return;
    if (info.timer) window.clearTimeout(info.timer);
    if (info.started) {
      e.preventDefault();
      const target = overStageRef.current;
      if (target && target !== info.stage) onMove(info.id, target as ClientStage);
    } else {
      const opened = clients.find((c) => c.id === info.id);
      if (opened && onCardOpen) onCardOpen(opened);
      else navigate(`/clients/${info.id}`);
    }
    cleanup();
  };

  return (
    <div ref={boardRef} className="kanban-board flex h-[calc(100vh-16rem)] min-w-0 max-w-full gap-4 overflow-x-auto px-6 pb-4">
      {stages.map((stage) => {
        const items = clients.filter((c) => c.stage === stage);
        const isOver = overStage === stage;
        return (
          <div
            key={stage}
            data-stage={stage}
            className={cn(
              'flex h-full w-72 sm:w-80 flex-shrink-0 flex-col rounded-2xl border transition-colors duration-150',
              isOver
                ? 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/40'
                : 'border-surface-200 bg-surface-100/40',
            )}
          >
            {/* Header da coluna (fixo) */}
            <div className={cn('flex flex-shrink-0 items-center justify-between px-3 py-2.5 transition-colors', isOver && 'text-primary-400')}>
              <span className="text-xs font-semibold uppercase tracking-wide">{stage}</span>
              <span className="font-ui rounded-md bg-surface-100 px-1.5 py-0.5 text-[10px] font-bold text-text-secondary">
                {items.length}
              </span>
            </div>

            {/* Cards (rolagem interna) */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-2.5 pb-2.5">
              {items.map((c) => (
                <div
                  key={c.id}
                  onPointerDown={(e) => onPointerDown(e, c)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={cleanup}
                  style={{ touchAction: 'pan-x pan-y', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                  className={cn(
                    'flex min-h-[112px] cursor-grab select-none flex-col rounded-xl border border-surface-200 bg-card-bg p-4 transition-[border-color,opacity] hover:border-primary-500/40 active:cursor-grabbing',
                    dragId === c.id && 'opacity-30',
                  )}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-text-primary">{c.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-text-secondary">{c.development || 'Sem empreendimento'}</p>
                    </div>
                    {renderActions?.(c)}
                  </div>
                  {c.intendedValue && (
                    <p className="font-ui mt-auto inline-block w-fit rounded-md bg-surface-100 px-2 py-0.5 text-xs font-semibold text-text-primary">
                      {c.intendedValue}
                    </p>
                  )}
                </div>
              ))}
              {items.length === 0 && (
                <div className="flex min-h-[112px] items-center justify-center rounded-xl border border-dashed border-surface-200 text-center text-[11px] text-text-secondary/50">
                  Solte aqui
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Fantasma — via portal no body (evita deslocamento por ancestral com transform) */}
      {createPortal(
        <div
          ref={ghostRef}
          style={{ display: 'none', left: 0, top: 0, willChange: 'transform' }}
          className="pointer-events-none fixed z-[100] w-64 rounded-xl border border-primary-500 bg-card-bg p-3 shadow-2xl shadow-black/50"
        >
          <p ref={ghostNameRef} className="line-clamp-2 text-sm font-semibold leading-snug text-text-primary" />
        </div>,
        document.body,
      )}
    </div>
  );
}
