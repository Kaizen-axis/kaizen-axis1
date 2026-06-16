-- Espelho de Vendas: adiciona a diretoria selecionável ao espelho.
-- Texto livre (nome da diretoria) para acompanhar o padrão das demais colunas
-- e não criar acoplamento de FK com directorates (o nome é o que vai impresso no PDF).
alter table public.sales_mirrors
  add column if not exists diretoria text;
