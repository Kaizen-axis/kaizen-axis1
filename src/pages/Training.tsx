import { useState, useEffect, useRef } from 'react';
import { PremiumCard, PageHeader, RoundedButton } from '@/components/ui/PremiumComponents';
import { PlayCircle, FileText, Image as ImageIcon, Plus, Edit2, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useApp, TrainingItem } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Usar worker via CDN — evita problemas de bundle
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// --- Componente auxiliar de visualização do PDF ---
function PDFViewer({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Mede a largura disponível do container para escalar as páginas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Busca o PDF e cria um Blob URL local (evita "Buffer is already detached"
  // que ocorre ao passar ArrayBuffer diretamente ao Web Worker)
  useEffect(() => {
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setLoadError(null);
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setLoadError('Não foi possível carregar o PDF.'));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <p className="text-red-500 text-sm text-center">{loadError}</p>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors">
          Abrir PDF
        </a>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-y-auto overflow-x-hidden"
      style={{ height: '78vh', background: 'var(--bg-subtle)' }}
    >
      {!blobUrl ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-text-secondary animate-pulse text-sm">Carregando PDF...</p>
        </div>
      ) : (
        <Document
          file={blobUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={null}
          error={
            <div className="flex flex-col items-center gap-4 p-6">
              <p className="text-red-500 text-sm text-center">Erro ao renderizar o PDF.</p>
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg">
                Abrir PDF
              </a>
            </div>
          }
        >
          {/* Renderiza TODAS as páginas empilhadas — scroll vertical nativo no mobile */}
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i} className="flex justify-center mb-2">
              <Page
                pageNumber={i + 1}
                width={containerWidth > 0 ? containerWidth : undefined}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="shadow-md"
              />
            </div>
          ))}
        </Document>
      )}
    </div>
  );
}
// ----------------------------------------------------
// Detecta duração de vídeo YouTube via IFrame Player API (sem API key)
function getYouTubeDuration(videoId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10000);

    const createPlayer = () => {
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(container);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const player = new (window as any).YT.Player(container, {
          videoId,
          playerVars: { autoplay: 0, mute: 1 },
          events: {
            onReady: (e: any) => {
              clearTimeout(timer);
              const secs: number = e.target.getDuration();
              if (secs > 0) {
                const m = Math.floor(secs / 60);
                const s = Math.round(secs % 60);
                resolve(`${m}:${s.toString().padStart(2, '0')} min`);
              } else {
                resolve(null);
              }
              try { player.destroy(); } catch { }
              container.remove();
            },
            onError: () => {
              clearTimeout(timer);
              resolve(null);
              try { player.destroy(); } catch { }
              container.remove();
            },
          },
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
        container.remove();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).YT?.Player) {
      createPlayer();
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prev = (window as any).onYouTubeIframeAPIReady;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).onYouTubeIframeAPIReady = () => { if (prev) prev(); createPlayer(); };
    }
  });
}

export default function Training() {
  const { isBroker, canCreateStrategicResources } = useAuthorization();
  const { trainings, addTraining, updateTraining, deleteTraining, getDownloadUrl, completeTraining } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<TrainingItem | null>(null);
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  // thumbnail gerado automaticamente: blob (PDF/Imagem) ou URL string (YouTube)
  const [autoThumbnailBlob, setAutoThumbnailBlob] = useState<Blob | null>(null);
  const [autoThumbnailUrl, setAutoThumbnailUrl] = useState<string>('');
  const [previewThumb, setPreviewThumb] = useState<string>('');

  const [formData, setFormData] = useState<Partial<TrainingItem>>({
    title: '',
    type: 'Vídeo',
    url: '',
    duration: '',
    description: '',
    xp_reward: 0
  });

  const resetAutoMeta = () => {
    setAutoThumbnailBlob(null);
    setAutoThumbnailUrl('');
    setPreviewThumb('');
  };

  const handleOpenModal = (item?: TrainingItem) => {
    if (item) {
      setEditingItemId(item.id);
      setFormData({
        title: item.title,
        type: item.type,
        url: item.url,
        duration: item.duration,
        description: item.description,
        xp_reward: item.xp_reward || 0
      });
      setPreviewThumb(item.thumbnail || '');
    } else {
      setEditingItemId(null);
      setFormData({ title: '', type: 'Vídeo', url: '', duration: '', description: '', xp_reward: 0 });
      resetAutoMeta();
    }
    setSelectedFile(null);
    setIsAddModalOpen(true);
  };

  // --- Auto-detect metadata ao selecionar arquivo ---
  useEffect(() => {
    if (!selectedFile) return;
    setIsProcessingFile(true);
    resetAutoMeta();

    if (formData.type === 'PDF') {
      // Usar pdfjs para contar páginas e gerar thumbnail da 1ª página
      (async () => {
        try {
          const buf = await selectedFile.arrayBuffer();
          const pdf = await pdfjs.getDocument({ data: buf }).promise;
          const numPages = pdf.numPages;
          setFormData(prev => ({ ...prev, duration: `${numPages} pág.` }));

          const page = await pdf.getPage(1);
          const vp = page.getViewport({ scale: 1 });
          const scale = 400 / vp.width;
          const scaled = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = Math.round(scaled.height);
          await page.render({ canvas, viewport: scaled }).promise;
          canvas.toBlob(blob => {
            if (blob) {
              setAutoThumbnailBlob(blob);
              setPreviewThumb(URL.createObjectURL(blob));
            }
          }, 'image/jpeg', 0.85);
        } catch (e) {
          console.error('Erro ao processar PDF:', e);
        } finally {
          setIsProcessingFile(false);
        }
      })();
    } else if (formData.type === 'Imagem') {
      // Usar a própria imagem como thumbnail
      setAutoThumbnailBlob(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setPreviewThumb(url);
      setIsProcessingFile(false);
    } else {
      setIsProcessingFile(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile]);

  // --- Auto-thumbnail e duração para YouTube quando URL mudar ---
  useEffect(() => {
    const url = formData.url || '';
    if (formData.type !== 'Vídeo') return;
    if (!url) { resetAutoMeta(); return; }
    const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
    if (match) {
      const videoId = match[1];
      const thumb = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      setAutoThumbnailUrl(thumb);
      setPreviewThumb(thumb);
      // Buscar duração em background via YouTube IFrame Player API
      getYouTubeDuration(videoId).then(dur => {
        if (dur) setFormData(prev => ({ ...prev, duration: dur }));
      });
    } else {
      resetAutoMeta();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.url, formData.type]);

  useEffect(() => {
    if (!viewingItem) {
      setViewingUrl(null);
      return;
    }
    if (viewingItem.url.startsWith('http')) {
      setViewingUrl(viewingItem.url);
    } else if (viewingItem.url) {
      getDownloadUrl(viewingItem.url).then(url => setViewingUrl(url));
    }
    // getDownloadUrl is not memoised in AppContext — omitting it from deps
    // is intentional to prevent infinite re-fetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingItem]);

  // --- Tracking Completion ---
  const pdfTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer for PDF completion
  useEffect(() => {
    if (viewingItem && viewingItem.type === 'PDF' && viewingItem.progress !== 100) {
      pdfTimerRef.current = setTimeout(() => {
        completeTraining(viewingItem.id);
      }, 120000); // 2 minutes
    }

    return () => {
      if (pdfTimerRef.current) clearTimeout(pdfTimerRef.current);
    };
  }, [viewingItem, completeTraining]);

  useEffect(() => {
    if (viewingItem && viewingItem.type === 'Vídeo' && viewingItem.progress !== 100) {
      const isYT = viewingItem.url.includes('youtube.com') || viewingItem.url.includes('youtu.be');
      if (isYT) {
        // Load YT API if missing
        if (!(window as any).YT) {
          if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(s);
          }
        }

        // Need to wait for iframe to render
        const checkIframe = setInterval(() => {
          const iframe = document.getElementById(`yt-player-${viewingItem.id}`) as HTMLIFrameElement;
          if (iframe && (window as any).YT && (window as any).YT.Player) {
            clearInterval(checkIframe);
            new (window as any).YT.Player(`yt-player-${viewingItem.id}`, {
              events: {
                'onStateChange': (event: any) => {
                  // YT.PlayerState.ENDED == 0
                  if (event.data === 0) {
                    completeTraining(viewingItem.id);
                  }
                }
              }
            });
          }
        }, 500);
        return () => clearInterval(checkIframe);
      }
    }
  }, [viewingItem, completeTraining]);

  const handleSave = async () => {
    if (!formData.title || (!formData.url && !selectedFile)) return;
    setIsSaving(true);
    setUploadError(null);
    try {
      let finalUrl = formData.url || '';
      let finalThumbnail = `https://picsum.photos/seed/${Date.now()}/400/300`;

      if (selectedFile) {
        const sanitizedName = selectedFile.name
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const path = `${Date.now()}_${sanitizedName}`;

        const { data, error } = await supabase.storage
          .from('trainings')
          .upload(path, selectedFile, {
            contentType: selectedFile.type || 'application/octet-stream',
          });

        if (error) {
          setUploadError(`Erro no upload: ${error.message}`);
          return;
        }

        const { data: urlData } = supabase.storage.from('trainings').getPublicUrl(data.path);
        finalUrl = urlData.publicUrl;

        // Upload da thumbnail gerada automaticamente
        if (autoThumbnailBlob) {
          const thumbPath = `thumbnails/${Date.now()}_thumb.jpg`;
          const { data: td, error: te } = await supabase.storage
            .from('trainings')
            .upload(thumbPath, autoThumbnailBlob, { contentType: 'image/jpeg' });
          if (!te && td) {
            const { data: tu } = supabase.storage.from('trainings').getPublicUrl(td.path);
            finalThumbnail = tu.publicUrl;
          }
        }
      }

      // Thumbnail do YouTube (URL direta, sem upload)
      if (autoThumbnailUrl) finalThumbnail = autoThumbnailUrl;

      if (!finalUrl) {
        setUploadError('Adicione um arquivo ou link antes de salvar.');
        return;
      }

      const payload = {
        title: formData.title,
        type: formData.type as 'Vídeo' | 'PDF' | 'Imagem',
        url: finalUrl,
        duration: formData.duration || 'N/A',
        description: formData.description || '',
        xp_reward: formData.xp_reward || 0,
      };

      if (editingItemId) {
        await updateTraining(editingItemId, payload);
      } else {
        await addTraining({ ...payload, thumbnail: finalThumbnail });
      }

      setIsAddModalOpen(false);
      setFormData({ title: '', type: 'Vídeo', url: '', duration: '', description: '', xp_reward: 0 });
      setSelectedFile(null);
      resetAutoMeta();
    } catch (e: any) {
      setUploadError(e?.message || 'Nao foi possivel salvar o treinamento.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    requestConfirm({
      title: 'Excluir treinamento',
      message: 'Tem certeza que deseja excluir este treinamento? Esta ação não poderá ser desfeita.',
      confirmLabel: 'Excluir',
      onConfirm: async () => {
        try {
          await deleteTraining(id);
        } catch (e: any) {
          alert(e?.message || 'Nao foi possivel excluir o treinamento.');
        }
      },
    });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'Vídeo': return <PlayCircle className="text-white" size={24} />;
      case 'PDF': return <FileText className="text-white" size={24} />;
      case 'Imagem': return <ImageIcon className="text-white" size={24} />;
      default: return <FileText className="text-white" size={24} />;
    }
  };

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <PageHeader
        eyebrow="Universidade Corporativa"
        title="Treinamentos"
        subtitle="Capacitação contínua para a sua evolução."
        action={canCreateStrategicResources ? (
          <RoundedButton size="sm" onClick={() => handleOpenModal()} className="flex items-center gap-1">
            <Plus size={16} /> Novo
          </RoundedButton>
        ) : undefined}
      />

      <div className="space-y-4">
        {trainings.map((item) => (
          <PremiumCard
            key={item.id}
            interactive="list"
            className="p-4 flex gap-4 relative group"
            onClick={() => setViewingItem(item)}
          >
            {canCreateStrategicResources && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); handleOpenModal(item); }}
                  className="p-2 bg-card-bg/90 dark:bg-black/80 text-text-secondary hover:text-gold-600 rounded-lg backdrop-blur-sm shadow-sm transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={(e) => handleDelete(item.id, e)}
                  className="p-2 bg-card-bg/90 dark:bg-black/80 text-text-secondary hover:text-red-500 rounded-lg backdrop-blur-sm shadow-sm transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}

            <div className="relative w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 bg-black">
              <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover opacity-80" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 flex items-center justify-center">
                {getIcon(item.type)}
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-between py-1">
              <div>
                <h4 className="font-semibold text-text-primary line-clamp-2 leading-tight">{item.title}</h4>
                <p className="text-xs text-text-secondary mt-1 flex items-center gap-1">
                  <span>{item.type} • {item.duration}</span>
                  {item.xp_reward && item.xp_reward > 0 && (
                    <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      +{item.xp_reward} XP
                    </span>
                  )}
                </p>
              </div>

              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span className={item.progress === 100 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-text-secondary'}>
                    {(item.progress ?? 0) === 100 ? 'Concluído' : `${item.progress ?? 0}%`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-surface-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${(item.progress ?? 0) === 100 ? 'bg-green-500' : 'bg-gold-400'}`}
                    style={{ width: `${item.progress ?? 0}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </PremiumCard>
        ))}
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingItemId ? "Editar Treinamento" : "Adicionar Treinamento"}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
            <input
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
              placeholder="Ex: Técnicas de Vendas"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Tipo</label>
            <div className="flex gap-2">
              {['Vídeo', 'PDF', 'Imagem'].map(type => (
                <button
                  key={type}
                  onClick={() => setFormData(prev => ({ ...prev, type: type as any }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${formData.type === type
                    ? 'bg-accent-subtle border-gold-400 text-gold-700 dark:text-gold-400'
                    : 'bg-surface-50 border-surface-200 text-text-secondary'
                    }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Mídia</label>
            <div className="flex flex-col gap-2">
              {formData.type === 'Vídeo' ? (
                /* Vídeos: apenas link externo (YouTube/Vimeo) */
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-2">
                    🎬 Para vídeos, use um link do YouTube ou Vimeo.
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mb-3">
                    Suba o vídeo no YouTube (pode ser não listado) e cole o link abaixo.
                  </p>
                  <input
                    value={formData.url || ''}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, url: e.target.value }));
                      setSelectedFile(null);
                    }}
                    className="w-full p-3 bg-card-bg dark:bg-surface-800 rounded-xl border border-amber-200 dark:border-amber-800 focus:ring-2 focus:ring-amber-300 text-text-primary text-sm"
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </div>
              ) : (
                /* PDF e Imagem: upload de arquivo ou link externo */
                <>
                  <input
                    type="file"
                    accept={formData.type === 'PDF' ? 'application/pdf' : 'image/*'}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                        setFormData(prev => ({ ...prev, url: '' }));
                      }
                    }}
                    className="w-full p-2 bg-surface-50 rounded-xl border border-surface-200 text-sm focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800"
                  />
                  <span className="text-xs text-center text-text-secondary">OU INSIRA UM LINK EXTERNO</span>
                  <input
                    value={formData.url || ''}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, url: e.target.value }));
                      setSelectedFile(null);
                    }}
                    className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                    placeholder="https://..."
                  />
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Duração / Páginas</label>
              <input
                value={formData.duration}
                onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="Ex: 30 min, 10 pág"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Recompensa (XP)</label>
              <input
                type="number"
                min="0"
                value={formData.xp_reward}
                onChange={(e) => setFormData(prev => ({ ...prev, xp_reward: parseInt(e.target.value) || 0 }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="Ex: 50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Descrição</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary min-h-[80px]"
              placeholder="Sobre o que é este treinamento..."
            />
          </div>

          {/* Preview da thumbnail gerada automaticamente */}
          {previewThumb && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs text-text-secondary self-start">Capa do treinamento</p>
              <img
                src={previewThumb}
                alt="Thumbnail"
                className="w-full max-h-40 object-cover rounded-xl border border-surface-200"
              />
            </div>
          )}

          {uploadError && (
            <div className="text-red-600 text-sm p-3 bg-red-50 rounded-xl border border-red-200">
              {uploadError}
            </div>
          )}

          <RoundedButton fullWidth onClick={handleSave} className="mt-4" disabled={isSaving}>
            {isSaving ? 'Enviando arquivo...' : editingItemId ? 'Atualizar' : 'Adicionar'}
          </RoundedButton>
        </div>
      </Modal>

      {/* View Modal */}
      {viewingItem && (
        <Modal
          isOpen={!!viewingItem}
          onClose={() => setViewingItem(null)}
          title={viewingItem.type}
        >
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-text-primary">{viewingItem.title}</h3>
            <p className="text-sm text-text-secondary">{viewingItem.description}</p>

            <div className="mt-4 bg-black rounded-xl overflow-hidden min-h-[50vh] flex items-center justify-center relative">
              {!viewingUrl ? (
                <div className="p-8 text-center text-white"><p>Carregando mídia...</p></div>
              ) : (
                <>
                  {viewingItem.type === 'Vídeo' && (() => {
                    const isYT = viewingUrl.includes('youtube.com') || viewingUrl.includes('youtu.be');
                    if (isYT) {
                      // Converte qualquer URL do YouTube para o formato embed
                      const toEmbedUrl = (url: string) => {
                        try {
                          const u = new URL(url);
                          let videoId = '';
                          if (u.hostname.includes('youtu.be')) {
                            videoId = u.pathname.slice(1);
                          } else {
                            videoId = u.searchParams.get('v') ||
                              u.pathname.replace('/shorts/', '').replace('/embed/', '').slice(1);
                          }
                          // Enable JS API for tracking completion
                          return `https://www.youtube.com/embed/${videoId}?enablejsapi=1`;
                        } catch {
                          return url;
                        }
                      };
                      return (
                        <iframe
                          id={`yt-player-${viewingItem.id}`}
                          src={toEmbedUrl(viewingUrl)}
                          className="w-full aspect-video"
                          title={viewingItem.title}
                          frameBorder="0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      );
                    }
                    return (
                      <video
                        src={viewingUrl}
                        controls
                        className="w-full aspect-video outline-none"
                        title={viewingItem.title}
                        onEnded={() => {
                          if (viewingItem.progress !== 100) {
                            completeTraining(viewingItem.id);
                          }
                        }}
                      />
                    );
                  })()}

                  {viewingItem.type === 'Imagem' && (
                    <img
                      src={viewingUrl}
                      alt={viewingItem.title}
                      className="w-full h-auto max-h-[70vh] object-contain"
                      referrerPolicy="no-referrer"
                    />
                  )}

                  {viewingItem.type === 'PDF' && (
                    <div className="w-full h-[80vh] flex flex-col items-center justify-center bg-surface-50 overflow-hidden relative">
                      <PDFViewer url={viewingUrl} />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setViewingItem(null)}
                className="text-sm text-text-secondary hover:text-text-primary"
              >
                Fechar
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
