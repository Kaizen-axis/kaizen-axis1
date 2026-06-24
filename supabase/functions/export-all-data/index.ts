// @ts-nocheck — Deno types não disponíveis no checker local; válido em runtime.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3';

const CORS_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

// Reflete a origem da requisição — funciona em produção (com/sem www) e nos
// deploys de preview. A segurança real é o JWT + gate de papel, não o CORS.
function buildCors(req: Request) {
  const origin = req.headers.get('Origin') || CORS_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Vary': 'Origin',
  };
}

const EXPORT_BUCKET = 'data-exports';
const DAILY_LIMIT = 5;
const SIGNED_TTL = 600;       // link do zip: 10 min (download é imediato)

// Tabelas de negócio incluídas no pacote (exclui logs, chat, tokens, base do Kai).
const TABLES = [
  'clients', 'client_proponents', 'client_history', 'client_documents',
  'appointments', 'tasks', 'leads', 'sales_events', 'sales_mirrors', 'approved_events',
  'developments', 'profiles', 'teams', 'directorates', 'daily_checkins', 'goals',
  'missions_templates', 'income_audits', 'user_points', 'user_achievements',
  'achievements', 'sales_streaks', 'trainings', 'training_completions',
];

// Colunas específicas por tabela (default '*'). income_audits.resultado_json é um
// blob enorme (detalhamento de transações da apuração) — exclui para não estourar
// os limites de memória da função; o resumo numérico é mantido.
const SELECTS: Record<string, string> = {
  income_audits: 'id, client_id, created_by, created_at, algoritmo_versao, hash_pdf, media_mensal_real, total_apurado, meses_considerados, renda_multiplo, validado_em',
};

function resolveIp(req: Request) {
  const f = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  return f ? (f.split(',')[0]?.trim() || '0.0.0.0') : '0.0.0.0';
}

function toCsv(rows: Record<string, any>[]): string {
  if (!rows || rows.length === 0) return '';
  const headerSet = new Set<string>();
  for (const r of rows) Object.keys(r).forEach((k) => headerSet.add(k));
  const headers = Array.from(headerSet);
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Proteção contra CSV/formula injection: neutraliza células que o Excel
    // interpretaria como fórmula (=, +, -, @, tab, CR) prefixando com aspa simples.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return lines.join('\r\n');
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCors(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401);
  const token = authHeader.slice(7);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Configuração do servidor ausente' }, 500);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Não autorizado' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Gate por papel
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = String(prof?.role || '').toUpperCase();
  if (role !== 'EXPORTADOR' && role !== 'ADMIN') return json({ error: 'Acesso restrito.' }, 403);

  // Rate limit diário
  const dayStart = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString();
  const { data: cnt, error: rlErr } = await admin.rpc('increment_request_counter', {
    _scope: 'data_export', _identifier: user.id, _window_start: dayStart,
  });
  if (rlErr) return json({ error: 'Falha ao aplicar limite de segurança' }, 500);
  if ((cnt ?? 0) > DAILY_LIMIT) return json({ error: 'Limite diário de exportações atingido. Tente amanhã.' }, 429);

  const zip = new JSZip();
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  // Tabelas -> CSV + JSON por tabela. Não acumulamos tudo num único objeto/string
  // gigante (evita estourar os limites de memória/CPU da função).
  for (const t of TABLES) {
    try {
      const { data, error } = await admin.from(t).select(SELECTS[t] || '*');
      if (error) { notes.push(`Tabela ${t}: erro (${error.message})`); continue; }
      const rows = data || [];
      counts[t] = rows.length;
      zip.file(`csv/${t}.csv`, toCsv(rows));
      zip.file(`json/${t}.json`, JSON.stringify(rows));
    } catch (e) { notes.push(`Tabela ${t}: falha (${(e as any)?.message})`); }
  }

  // Relatórios consolidados (best-effort)
  for (const rpc of ['get_report_metrics', 'get_presence_report', 'get_relatorio_diretoria']) {
    try {
      const { data, error } = await admin.rpc(rpc);
      if (error) { notes.push(`Relatório ${rpc}: ${error.message}`); continue; }
      zip.file(`relatorios/${rpc}.json`, JSON.stringify(data, null, 2));
    } catch (e) { notes.push(`Relatório ${rpc}: ${(e as any)?.message}`); }
  }

  // LEIA-ME
  const generatedAt = new Date().toISOString();
  const readme = [
    'KAIZEN AXIS — Exportação de dados',
    `Gerado em: ${generatedAt}`,
    '',
    'Conteúdo do pacote:',
    '- csv/            : um arquivo CSV por conjunto de dados',
    '- json/          : todos os dados estruturados por tabela (para migração)',
    '- csv/client_documents.csv : lista de documentos dos clientes (nome, tipo, caminho no armazenamento)',
    '- relatorios/     : relatórios consolidados',
    '',
    'Contagens por conjunto:',
    ...Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`),
    '',
    'AVISO (LGPD): este pacote contém DADOS PESSOAIS de clientes e da equipe,',
    'incluindo CPF. Quem baixa é responsável pelo armazenamento e tratamento',
    'em conformidade com a Lei Geral de Proteção de Dados.',
    notes.length ? '\nObservações de geração:' : '',
    ...notes.map((n) => `- ${n}`),
  ].join('\n');
  zip.file('LEIA-ME.txt', readme);

  // Gera o zip
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });

  // Limpeza: remove pacotes anteriores (mantém no máximo o mais recente no bucket)
  try {
    const { data: prev } = await admin.storage.from(EXPORT_BUCKET).list('exportador', { limit: 100 });
    const toRemove = (prev || []).map((o) => `exportador/${o.name}`);
    if (toRemove.length) await admin.storage.from(EXPORT_BUCKET).remove(toRemove);
  } catch (e) { notes.push(`limpeza de exports anteriores: ${(e as any)?.message}`); }

  // Upload no bucket privado
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const objectPath = `exportador/kaizen-axis-export-${stamp}.zip`;
  const { error: upErr } = await admin.storage.from(EXPORT_BUCKET).upload(objectPath, bytes, {
    contentType: 'application/zip', upsert: true,
  });
  if (upErr) { console.error('[export-all-data] upload', upErr.message); return json({ error: 'Falha ao gerar o pacote.' }, 500); }

  const { data: signed, error: signErr } = await admin.storage.from(EXPORT_BUCKET).createSignedUrl(objectPath, SIGNED_TTL);
  if (signErr || !signed?.signedUrl) return json({ error: 'Falha ao gerar o link de download.' }, 500);

  // Auditoria (aguardada — operação sensível não fica sem registro)
  const { error: auditErr } = await admin.from('audit_logs').insert({
    user_id: user.id, action: 'data_export', entity: 'export', entity_id: null,
    ip_address: resolveIp(req), device_info: req.headers.get('user-agent') || 'unknown',
    metadata: { counts, notes, object_path: objectPath },
  });
  if (auditErr) console.warn('[export-all-data] audit insert failed', auditErr.message);

  return json({ url: signed.signedUrl, generated_at: generatedAt, counts });
});
