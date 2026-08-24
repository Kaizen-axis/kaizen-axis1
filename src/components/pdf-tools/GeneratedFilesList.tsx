import { GeneratedFile } from '@/types/pdf-tools';
import { Download, Trash2, FileCheck, Calendar } from 'lucide-react';
import { PremiumCard } from '@/components/ui/PremiumComponents';

interface GeneratedFilesListProps {
  files: GeneratedFile[];
  onDownload: (file: GeneratedFile) => void;
  onDelete: (id: string) => void;
}

export function GeneratedFilesList({ files, onDownload, onDelete }: GeneratedFilesListProps) {
  if (files.length === 0) return null;

  return (
    <div className="space-y-3 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
        <FileCheck className="text-green-500" size={20} />
        Arquivos Processados
      </h3>
      
      <div className="grid gap-3">
        {files.map((file) => (
          <PremiumCard key={file.id} className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">
              <FileCheck size={20} />
            </div>
            
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-text-primary truncate">{file.name}</h4>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface-100 text-text-secondary font-medium">
                  {file.type}
                </span>
                <span className="text-xs text-text-secondary flex items-center gap-1">
                  <Calendar size={10} />
                  {file.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-xs text-text-secondary">
                  {file.size}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => onDownload(file)}
                className="p-2 rounded-lg bg-gold-500 text-white shadow-md shadow-gold-500/20 hover:bg-gold-600 transition-colors"
                title="Baixar PDF"
              >
                <Download size={16} />
              </button>
              <button 
                onClick={() => onDelete(file.id)}
                className="p-2 rounded-lg hover:bg-danger-subtle text-text-secondary hover:text-red-500 transition-colors"
                title="Excluir"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </PremiumCard>
        ))}
      </div>
    </div>
  );
}
