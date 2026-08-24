import { FileItem } from '@/types/pdf-tools';
import { RotateCcw, RotateCw, X, GripVertical, FileText } from 'lucide-react';
import { Reorder, useDragControls } from 'motion/react';

interface FilePreviewCardProps {
  item: FileItem;
  index: number;
  onRemove: (id: string) => void;
  onRotateLeft?: (id: string) => void;
  onRotateRight?: (id: string) => void;
}

export function FilePreviewCard({ item, index, onRemove, onRotateLeft, onRotateRight }: FilePreviewCardProps) {
  const controls = useDragControls();

  return (
    <Reorder.Item 
      value={item} 
      id={item.id}
      dragListener={false}
      dragControls={controls}
      className="bg-white dark:bg-surface-100 rounded-xl p-3 shadow-sm border border-surface-200 flex items-center gap-3 mb-2 select-none"
    >
      {/* Drag Handle */}
      <div 
        className="cursor-grab active:cursor-grabbing text-text-secondary hover:text-gold-500 p-1 touch-none"
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical size={20} />
      </div>

      {/* Index */}
      <div className="w-6 h-6 rounded-full bg-surface-100 dark:bg-surface-200 flex items-center justify-center text-xs font-bold text-text-secondary">
        {index + 1}
      </div>

      {/* Thumbnail / Icon */}
      <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-50 flex items-center justify-center border border-surface-200 relative">
        {item.type === 'image' && item.previewUrl ? (
          <img 
            src={item.previewUrl} 
            alt={item.name} 
            className="w-full h-full object-cover transition-transform duration-300"
            style={{ transform: `rotate(${item.rotation}deg)` }}
          />
        ) : (
          <FileText className="text-gold-500" size={24} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-text-primary truncate">{item.name}</h4>
        <p className="text-xs text-text-secondary">{item.size}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {item.type === 'image' && onRotateLeft && onRotateRight && (
          <>
            <button 
              onClick={() => onRotateLeft(item.id)}
              className="p-1.5 rounded-lg hover:bg-surface-100 text-text-secondary hover:text-gold-600 transition-colors"
              title="Girar Esquerda"
            >
              <RotateCcw size={16} />
            </button>
            <button 
              onClick={() => onRotateRight(item.id)}
              className="p-1.5 rounded-lg hover:bg-surface-100 text-text-secondary hover:text-gold-600 transition-colors"
              title="Girar Direita"
            >
              <RotateCw size={16} />
            </button>
          </>
        )}
        <button 
          onClick={() => onRemove(item.id)}
          className="p-1.5 rounded-lg hover:bg-danger-subtle text-text-secondary hover:text-red-500 transition-colors ml-1"
          title="Remover"
        >
          <X size={16} />
        </button>
      </div>
    </Reorder.Item>
  );
}
