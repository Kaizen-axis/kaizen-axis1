import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { X, CheckCircle2, ScanLine, RotateCcw, RotateCw } from 'lucide-react';

interface ImageScanModalProps {
    imageFile: File;
    onConfirm: (croppedFile: File) => void;
    onClose: () => void;
}

function getCenteredCrop(width: number, height: number): Crop {
    return centerCrop(
        makeAspectCrop({ unit: '%', width: 90 }, width / height, width, height),
        width,
        height
    );
}

export function ImageScanModal({ imageFile, onConfirm, onClose }: ImageScanModalProps) {
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const [rotation, setRotation] = useState(0);
    const imgRef = useRef<HTMLImageElement>(null);
    const objectUrl = useRef(URL.createObjectURL(imageFile));

    const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        setCrop(getCenteredCrop(w, h));
    }, []);

    const handleConfirm = () => {
        const img = imgRef.current;
        if (!img || !completedCrop) return;

        const canvas = document.createElement('canvas');
        const scaleX = img.naturalWidth / img.width;
        const scaleY = img.naturalHeight / img.height;

        // Apply rotation then crop
        const cropW = completedCrop.width * scaleX;
        const cropH = completedCrop.height * scaleY;
        const rad = (rotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const outW = Math.round(cropW * cos + cropH * sin);
        const outH = Math.round(cropW * sin + cropH * cos);

        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.translate(outW / 2, outH / 2);
        ctx.rotate(rad);
        ctx.drawImage(
            img,
            completedCrop.x * scaleX,
            completedCrop.y * scaleY,
            cropW,
            cropH,
            -cropW / 2,
            -cropH / 2,
            cropW,
            cropH,
        );

        canvas.toBlob(blob => {
            if (blob) onConfirm(new File([blob], imageFile.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.95);
    };

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#1a2329] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded-lg">
                            <ScanLine size={20} />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-900 dark:text-white">Recortar Documento</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Arraste a área sobre o documento e confirme</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-surface-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Crop area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-100 dark:bg-[#0d1418]">
                    <ReactCrop
                        crop={crop}
                        onChange={c => setCrop(c)}
                        onComplete={c => setCompletedCrop(c)}
                        style={{ maxHeight: '60vh' }}
                    >
                        <img
                            ref={imgRef}
                            src={objectUrl.current}
                            alt="Imagem para recortar"
                            style={{
                                maxHeight: '60vh',
                                maxWidth: '100%',
                                transform: `rotate(${rotation}deg)`,
                                transition: 'transform 0.2s',
                            }}
                            onLoad={onImageLoad}
                        />
                    </ReactCrop>
                </div>

                {/* Rotation controls */}
                <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#111b21]">
                    <div className="flex items-center justify-center gap-2">
                        <span className="text-xs text-gray-500 mr-2">Rotação:</span>
                        <button onClick={() => setRotation(r => r - 90)} className="px-3 py-1.5 text-xs font-bold bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-surface-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-200">−90°</button>
                        <button onClick={() => setRotation(r => r - 1)}  className="px-3 py-1.5 text-xs bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-surface-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-200 flex items-center gap-1"><RotateCcw size={11}/>−1°</button>
                        <button onClick={() => setRotation(0)} className="px-3 py-1.5 text-xs bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-surface-100 dark:hover:bg-gray-800 transition-colors text-gray-500">0°</button>
                        <button onClick={() => setRotation(r => r + 1)}  className="px-3 py-1.5 text-xs bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-surface-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-200 flex items-center gap-1"><RotateCw size={11}/>+1°</button>
                        <button onClick={() => setRotation(r => r + 90)} className="px-3 py-1.5 text-xs font-bold bg-white dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-surface-100 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-200">+90°</button>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#0d1418] flex gap-3">
                    <button onClick={onClose} className="flex-1 py-3 px-4 bg-white dark:bg-[#202c33] text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-xl font-medium text-sm hover:bg-surface-100 dark:hover:bg-[#2a3942] transition-colors">
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!completedCrop?.width || !completedCrop?.height}
                        className="flex-[2] py-3 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                    >
                        <CheckCircle2 size={16} /> Confirmar Recorte
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
