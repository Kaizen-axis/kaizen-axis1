import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PremiumCard, RoundedButton, SectionHeader } from '@/components/ui/PremiumComponents';
import { ChevronLeft, Send, Paperclip, FileText, X, Loader2 } from 'lucide-react';
import { Client } from '@/data/clients';
import { EmailInput } from '@/components/ui/EmailInput';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { buildAuthenticatedFunctionHeaders } from '@/lib/supabase-functions';
import { logAuditEvent } from '@/services/auditLogger';

interface Attachment {
  name: string;
  document_id?: string;
  file_path?: string; // Supabase Storage path
  file?: File;       // manually added file
}

export default function SendEmail({
  clientId,
  embedded = false,
  onClose,
}: {
  clientId?: string;
  embedded?: boolean;
  onClose?: () => void;
} = {}) {
  const params = useParams();
  const id = clientId || params.id;
  const navigate = useNavigate();
  const { getClient, userName, profile, allProfiles, getDownloadUrl } = useApp();
  const [client, setClient] = useState<Client | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    const found = getClient(id);
    if (found) {
      setClient(found);
      if (found.email) {
        setTo(prev => (prev.length ? prev : [found.email]));
      }
      const empreendimento = (found.development || 'NÃO INFORMADO').toUpperCase();

      // ── Resolve hierarchy from the CLIENT OWNER, not the logged-in user ──
      const ownerProfile = allProfiles.find(p => p.id === (found as any).owner_id);
      const ownerRole = ownerProfile?.role?.toUpperCase();

      let managerName: string;
      let coordinatorName: string;
      let corretorName: string;

      if (!ownerProfile) {
        managerName = 'NÃO INFORMADO';
        coordinatorName = '';
        corretorName = userName.toUpperCase();
      } else if (ownerRole === 'GERENTE') {
        // Owner is the manager — they acted as the broker too
        managerName = ownerProfile.name.toUpperCase();
        coordinatorName = '';
        corretorName = ownerProfile.name.toUpperCase();
      } else if (ownerRole === 'COORDENADOR') {
        // Owner is the coordinator — look up manager via direct manager_id FK
        coordinatorName = ownerProfile.name.toUpperCase();
        const managerObj = allProfiles.find(p => p.id === (ownerProfile as any).manager_id);
        managerName = managerObj ? managerObj.name.toUpperCase() : 'NÃO INFORMADO';
        corretorName = ownerProfile.name.toUpperCase();
      } else {
        // Owner is CORRETOR (or unknown) — resolve hierarchy via direct coordinator_id / manager_id FKs
        corretorName = ownerProfile.name.toUpperCase();
        const coordObj = allProfiles.find(p => p.id === ownerProfile.coordinator_id);
        coordinatorName = coordObj ? coordObj.name.toUpperCase() : '';

        // Prefer direct manager_id; fallback to coordinator's manager_id
        const directManagerId = (ownerProfile as any)?.manager_id;
        const cascadeManagerId = (coordObj as any)?.manager_id;
        const resolvedManagerId = directManagerId || cascadeManagerId;
        const managerObj = allProfiles.find(p => p.id === resolvedManagerId);
        managerName = managerObj ? managerObj.name.toUpperCase() : 'NÃO INFORMADO';
      }

      setSubject(
        (() => {
          const unifiedProponents = [
            {
              name: found.name,
              cpf: found.cpf,
            },
            ...((found.proponents || []).map((p) => ({
              name: p.name,
              cpf: p.cpf,
            }))),
          ];

          const proponentSummary = unifiedProponents
            .map((p) => `${(p.name || 'SEM NOME').toUpperCase()}${p.cpf ? ` (${p.cpf})` : ''}`)
            .join(' | ');

          return `KAIZEN IMÓVEIS | SOLICITO ANÁLISE | ${empreendimento} | ${proponentSummary} | GERÊNCIA: ${managerName}`;
        })()
      );

      const unifiedProponents = [
        {
          name: found.name,
          cpf: found.cpf,
          email: found.email,
          phone: found.phone,
          address: found.address,
          grossIncome: found.grossIncome,
          profession: found.profession,
          incomeType: found.incomeType,
          cotista: found.cotista,
          socialFactor: found.socialFactor,
        },
        ...((found.proponents || []).map((p) => ({
          name: p.name,
          cpf: p.cpf,
          email: p.email,
          phone: p.phone,
          address: p.address,
          grossIncome: p.grossIncome,
          profession: p.profession,
          incomeType: p.incomeType,
          cotista: p.cotista,
          socialFactor: p.socialFactor,
        }))),
      ];

      const proponentsBlock = unifiedProponents
        .map((p, idx) => {
          return `PROPONENTE ${idx + 1}
NOME: ${(p.name || 'Não informado').toUpperCase()}
CPF: ${p.cpf || 'Não informado'}
E-MAIL: ${p.email || 'Não informado'}
TELEFONE: ${p.phone || 'Não informado'}
ENDEREÇO: ${p.address || 'Não informado'}
RENDA: ${p.grossIncome || 'Não informado'}
TIPO DE RENDA: ${p.incomeType || 'Não informado'}
PROFISSÃO: ${p.profession || 'Não informado'}
COTISTA: ${p.cotista || 'Não informado'}
FATOR SOCIAL: ${p.socialFactor || 'Não informado'}`;
        })
        .join('\n\n');

      const template = `Bom dia time, solicito a análise do cliente em questão.

GERENTE: ${managerName}
COORDENADOR: ${coordinatorName}
CORRETOR: ${corretorName}

${proponentsBlock}`;

      setBody(template);

      // Auto-populate with client's uploaded documents
      if (found.documents && found.documents.length > 0) {
        setAttachments(found.documents.map((d: any) => ({
          name: d.name,
          document_id: d.id,
          file_path: d.file_path
        })));
      }
    }
  }, [id, getClient, userName, profile, allProfiles]);

  // Convert a URL or File to base64 string
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data URL prefix (e.g., "data:application/pdf;base64,")
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const urlToBase64 = async (url: string): Promise<string> => {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], 'attachment');
    return fileToBase64(file);
  };

  const handleSend = async () => {
    if (to.length === 0) {
      alert('Por favor, adicione pelo menos um destinatário.');
      return;
    }

    setIsSending(true);
    try {
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const functionHeaders = buildAuthenticatedFunctionHeaders({
        accessToken: session?.access_token,
        anonKey: SUPABASE_ANON_KEY,
      });

      // Build base64 attachments
      const resendAttachments: { filename: string; content: string }[] = [];

      for (const att of attachments) {
        try {
          let base64Content: string | null = null;

          if (att.file) {
            // Arquivo adicionado manualmente
            base64Content = await fileToBase64(att.file);
          } else if (att.file_path) {
            // Resolve path relativo (pode estar salvo como URL pública completa)
            let storagePath = att.file_path;
            const PUBLIC_MARKER = '/object/public/client-documents/';
            const SIGN_MARKER   = '/object/sign/client-documents/';
            if (storagePath.includes(PUBLIC_MARKER)) {
              storagePath = storagePath.split(PUBLIC_MARKER)[1];
            } else if (storagePath.includes(SIGN_MARKER)) {
              storagePath = storagePath.split(SIGN_MARKER)[1].split('?')[0];
            }
            storagePath = storagePath.startsWith('/') ? storagePath.slice(1) : storagePath;

            if (!att.document_id) {
              console.warn(`Anexo sem document_id (legado): ${att.name}`);
              continue;
            }

            // Fluxo definitivo: somente função segura v2 (documentId + RLS)
            let attachSignedUrl: string | null = null;
            if (session?.access_token) {
              try {
                const { data: v2Data, error: v2Error } = await supabase.functions.invoke('get-doc-url-v2', {
                  headers: functionHeaders,
                  body: { documentId: att.document_id, rawPath: att.file_path, expiresIn: 300 },
                });
                if (!v2Error) {
                  attachSignedUrl = v2Data.signedUrl ?? null;
                }
              } catch { /* ignora e segue com erro controlado abaixo */ }
            }

            if (!attachSignedUrl) {
              throw new Error(`Falha ao gerar link seguro do anexo: ${att.name}`);
            }

            if (attachSignedUrl) {
              base64Content = await urlToBase64(attachSignedUrl);
              logAuditEvent({
                action: 'document_downloaded',
                entity: 'client_document',
                entityId: storagePath,
                metadata: { client_id: id, context: 'email_attachment' }
              });
            }
          }

          if (base64Content) {
            resendAttachments.push({
              filename: att.name,
              content: base64Content,
            });
          }
        } catch (e) {
          console.warn(`Falha ao carregar anexo "${att.name}":`, e);
        }
      }

      const { data, error: invokeError } = await supabase.functions.invoke('send-email', {
        headers: functionHeaders,
        body: {
          to,
          cc,
          bcc,
          subject,
          text: body,
          attachments: resendAttachments,
        },
      });

      if (invokeError) {
        // Tenta extrair mensagem real do corpo da resposta
        let errorMsg = invokeError.message || 'Erro ao chamar função de envio.';
        try {
          const ctx = (invokeError as any).context;
          if (ctx) {
            const parsed = typeof ctx === 'string' ? JSON.parse(ctx) : await ctx.json?.();
            if (parsed?.error) errorMsg = parsed.error;
          }
        } catch { /* usa mensagem padrão */ }
        throw new Error(errorMsg);
      }

      if (data?.error || (data?.resend_ok === false)) {
        const resendMsg = data.error
          || data.resend_data?.message
          || data.resend_data?.name
          || JSON.stringify(data.resend_data);
        throw new Error(resendMsg);
      }

      alert(`Email enviado com sucesso! ✅\n${resendAttachments.length} anexo(s) incluído(s).`);
      if (embedded) onClose?.();
      else navigate(-1);
    } catch (error: any) {
      console.error('Erro ao enviar e-mail:', error);
      alert(`Erro ao enviar e-mail:\n\n${error.message || 'Tente novamente.'}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        name: file.name,
        file,
      }));
      setAttachments(prev => [...prev, ...newFiles]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!client) return <div className="p-6">Carregando...</div>;

  return (
    <div className={embedded ? '' : 'min-h-screen bg-surface-50 pb-24'}>
      {!embedded && (
      <div className="bg-card-bg shadow-sm px-4 py-4 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Novo Email</h1>
        </div>
        <button
          onClick={handleSend}
          disabled={isSending}
          className="bg-gold-400 text-white px-4 py-2 rounded-full font-medium text-sm flex items-center gap-2 shadow-md hover:bg-gold-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
          {isSending ? 'Enviando...' : 'Enviar'}
        </button>
      </div>
      )}

      <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
        <PremiumCard className="space-y-4">
          <EmailInput
            label="Para"
            emails={to}
            onEmailsChange={setTo}
            placeholder="analise@banco.com"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EmailInput
              label="Cc"
              emails={cc}
              onEmailsChange={setCc}
              placeholder="copia@empresa.com"
            />

            <EmailInput
              label="Cco (Bcc)"
              emails={bcc}
              onEmailsChange={setBcc}
              placeholder="secreto@empresa.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Assunto</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary font-medium"
            />
          </div>
        </PremiumCard>

        <PremiumCard className={`flex-1 flex flex-col ${embedded ? 'min-h-[280px]' : 'min-h-[500px]'}`}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`w-full flex-1 bg-transparent border-none resize-y focus:outline-none text-text-primary leading-relaxed whitespace-pre-wrap ${embedded ? 'min-h-[220px]' : 'min-h-[400px]'}`}
            placeholder="Escreva sua mensagem..."
          />

          {/* Attachments Area */}
          <div className="mt-4 pt-4 border-t border-surface-100">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1">
                <Paperclip size={12} /> Anexos ({attachments.length})
              </h4>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-gold-600 dark:text-gold-400 font-medium hover:underline cursor-pointer"
              >
                Adicionar
              </button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="application/pdf,image/*"
                multiple
                onChange={handleFileChange}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {attachments.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-surface-100 dark:bg-surface-200 px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-300">
                  <div className="w-6 h-6 bg-red-100 dark:bg-red-900/30 text-red-500 rounded flex items-center justify-center">
                    <FileText size={12} />
                  </div>
                  <span className="text-xs font-medium text-text-primary truncate max-w-[150px]">{file.name}</span>
                  {file.file_path && (
                    <span className="text-[10px] text-text-secondary">(storage)</span>
                  )}
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                    className="text-text-secondary hover:text-red-500 ml-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {attachments.length === 0 && (
                <p className="text-xs text-text-secondary italic">Nenhum anexo selecionado.</p>
              )}
            </div>
          </div>
        </PremiumCard>

        {embedded && (
          <button
            onClick={handleSend}
            disabled={isSending}
            className="w-full bg-gold-400 text-white px-4 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 shadow-md hover:bg-gold-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            {isSending ? 'Enviando...' : 'Enviar'}
          </button>
        )}
      </div>
    </div>
  );
}
