-- Bucket privado para os pacotes de exportação gerados pela função export-all-data.
-- Sem acesso público: o download só ocorre via URL assinada gerada com service role.
insert into storage.buckets (id, name, public)
values ('data-exports', 'data-exports', false)
on conflict (id) do nothing;
