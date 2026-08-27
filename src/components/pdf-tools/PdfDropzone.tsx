import { useCallback } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';

interface PdfDropzoneProps {
    onFilesAccepted: (files: File[]) => void;
    acceptType: 'image' | 'pdf';
    maxFiles?: number;
    maxSizeMB?: number;
}

export function PdfDropzone({ onFilesAccepted, acceptType, maxFiles = 10, maxSizeMB = 500 }: PdfDropzoneProps) {
    const maxSize = maxSizeMB * 1024 * 1024;

    const onDrop = useCallback((acceptedFiles: File[], fileRejections: FileRejection[]) => {
        if (fileRejections.length > 0) {
            const errors = fileRejections.map(r => r.file.name).join(', ');
            alert(`Alguns arquivos foram rejeitados (tamanho ou limite): ${errors}`);
        }
        onFilesAccepted(acceptedFiles);
    }, [onFilesAccepted]);

    const acceptConfig = acceptType === 'image'
        ? { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] }
        : { 'application/pdf': ['.pdf'] };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: acceptConfig,
        maxFiles,
        maxSize
    });

    return (
        <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors duration-200
        ${isDragActive
                    ? 'border-gold-500 bg-gold-50 dark:bg-gold-500/10'
                    : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#1a2329] hover:bg-gray-100 dark:hover:bg-[#202c33] hover:border-gold-400'
                }`}
        >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center gap-4">
                <div className={`p-4 rounded-full ${isDragActive ? 'bg-gold-100 dark:bg-gold-900/30 text-gold-600' : 'bg-white dark:bg-[#2a3942] text-gray-400 shadow-sm'}`}>
                    <UploadCloud size={32} />
                </div>
                <div>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-200">
                        Arraste arquivos aqui ou clique para selecionar
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {acceptType === 'pdf' ? 'Apenas arquivos PDF' : 'Imagens JPG, PNG, WEBP'}. Máx {maxSizeMB}MB
                    </p>
                </div>
            </div>
        </div>
    );
}
