/**
 * Backfill retroativo de presença em daily_checkins.
 *
 * Uso:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-presence-date.mjs 2026-08-14
 */
import { createClient } from '@supabase/supabase-js';

const date = process.argv[2] || '2026-08-14';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Defina SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.rpc('admin_backfill_daily_presence', { p_date: date });

if (error) {
  console.error('Falha no backfill:', error.message);
  process.exit(1);
}

console.log('Backfill concluído:', data);
