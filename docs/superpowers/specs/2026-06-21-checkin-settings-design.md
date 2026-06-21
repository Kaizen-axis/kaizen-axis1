# Configuração de Check-in no Painel Administrativo — Design

**Data:** 2026-06-21
**Branch:** `preview/checkin-settings` (base: `preview/v3`)
**Status:** Aprovado

## Problema

Hoje, qualquer alteração nos parâmetros que controlam o check-in dos usuários
exige editar o código da edge function `checkin-geo` e fazer redeploy. Isso torna
o ADMIN dependente do desenvolvedor para mudanças operacionais simples (ex:
ajustar o horário permitido).

Parâmetros hardcoded / em env var hoje:

| Parâmetro | Local atual | Valor atual |
|---|---|---|
| Janela de horário | `checkin-geo/index.ts` (hardcoded, linhas 154-158) | `08:00–13:30` BRT |
| Localização do escritório | env vars `OFFICE_LATITUDE` / `OFFICE_LONGITUDE` | `-23.5505 / -46.6333` |
| Raio máximo | `checkin-geo/index.ts` `MAX_RADIUS` (hardcoded) | `1000 m` |
| Precisão mínima do GPS | `checkin-geo/index.ts` `MAX_ACCURACY` (hardcoded) | `120 m` |

A exibição no app (`CheckIn.tsx`) também repete `08:00–13:30` hardcoded em vários
pontos, o que pode divergir do enforcement real.

## Objetivo

Criar uma sub-aba "Check-in" no Painel Administrativo (somente ADMIN) onde os
parâmetros de check-in são editados de forma intuitiva. A edge function e o app
passam a ler esses valores de uma única fonte de verdade no banco. O desenvolvedor
não precisa mais mexer em código para mudanças operacionais.

## Escopo

**Incluído:**
- Janela de horário única (início/fim) válida todos os dias.
- Localização do escritório (latitude/longitude).
- Raio máximo permitido (metros).
- Precisão mínima aceitável do GPS (metros).

**Fora de escopo (YAGNI):**
- Horários por dia da semana.
- Interruptor global de feriado / ativar-desativar.
- Mapa interativo para escolher localização (usaremos GPS do dispositivo + campos).

## Arquitetura

Fonte de verdade única: tabela `checkin_settings` (linha única, padrão singleton).
A edge function lê essa linha a cada check-in (com fallback aos defaults atuais).
O app lê via `AppContext` para exibir e para o formulário de edição.

```
[Admin UI: aba Check-in]  --update-->  [checkin_settings]  <--read--  [edge checkin-geo]
        ^                                      |
        |--read via AppContext-----------------|
[CheckIn.tsx: exibição] <----------------------|
```

### 1. Banco de dados

Nova tabela `public.checkin_settings`:

| Coluna | Tipo | Default | Notas |
|---|---|---|---|
| `id` | smallint PK | `1` | `check (id = 1)` — garante linha única |
| `start_minutes` | smallint | `480` | minutos desde 00:00 BRT (08:00) |
| `end_minutes` | smallint | `810` | 13:30 |
| `office_latitude` | double precision | `-23.5505` | |
| `office_longitude` | double precision | `-46.6333` | |
| `max_radius_meters` | integer | `1000` | |
| `max_accuracy_meters` | integer | `120` | |
| `updated_at` | timestamptz | `now()` | atualizado em cada save |
| `updated_by` | uuid | null | `profiles.id` de quem salvou |

A migration **semeia exatamente 1 linha com os valores de produção atuais**, de
modo que o comportamento permanece idêntico até que um ADMIN altere algo.

Constraints de integridade (defesa em profundidade, além da validação no front):
- `check (start_minutes >= 0 and start_minutes < 1440)`
- `check (end_minutes > start_minutes and end_minutes < 1440)`
- `check (office_latitude between -90 and 90)`
- `check (office_longitude between -180 and 180)`
- `check (max_radius_meters between 50 and 50000)`
- `check (max_accuracy_meters between 10 and 1000)`

**RLS:**
- `SELECT`: qualquer usuário autenticado (o app precisa exibir o horário).
- `INSERT` / `UPDATE`: apenas `role = 'ADMIN'` (subquery em `profiles`, padrão das
  demais policies do projeto).
- A edge function usa a service role key e ignora RLS — sempre consegue ler.

### 2. Edge function `checkin-geo`

- No início do handler (após autenticação), lê a linha de `checkin_settings` via
  service client já existente.
- Substitui as constantes hardcoded (`OFFICE_LAT`, `OFFICE_LNG`, `MAX_RADIUS`,
  `MAX_ACCURACY`) e a janela `08:00–13:30` pelos valores lidos.
- **Fallback robusto:** se a query falhar ou a linha não existir, usa os defaults
  atuais. O check-in nunca quebra por causa de configuração ausente.
- As mensagens de erro de horário/raio passam a refletir os valores configurados
  (ex: "Check-in permitido apenas entre HH:MM e HH:MM").

### 3. Frontend — AppContext

Seguindo o padrão de `directorates`:
- Novo estado `checkinSettings: CheckinSettings | null`.
- `refreshCheckinSettings()` — carrega a linha.
- `updateCheckinSettings(data)` — faz upsert na linha `id = 1` com `updated_by` =
  usuário atual; depois atualiza o estado.
- Tipo `CheckinSettings` exportado do AppContext.

### 4. Frontend — nova aba "Check-in" (AdminPanel)

- Adicionar `'checkin'` ao tipo `Tab` e ao array de abas com `adminOnly: true`
  (ícone `Clock` ou `MapPin`).
- Bloco de conteúdo renderizado quando `activeTab === 'checkin'`.
- Formulário:
  - **Horário:** dois `<input type="time">` (início/fim). Conversão de/para minutos
    via helpers (`minutesToHHMM` / `hhmmToMinutes`).
  - **Localização:** campos `latitude` / `longitude` + botão **"Usar minha
    localização atual"** que chama `navigator.geolocation.getCurrentPosition` e
    preenche os campos (com tratamento de erro/permissão negada).
  - **Raio máximo (m)** e **Precisão mínima do GPS (m):** campos numéricos com
    texto de ajuda explicando cada um.
  - Botão **Salvar** com estado de carregamento e feedback de sucesso/erro.
- **Validação inline antes de salvar:**
  - fim > início
  - latitude ∈ [-90, 90]; longitude ∈ [-180, 180]
  - raio ∈ [50, 50000]
  - precisão ∈ [10, 1000]

### 5. Frontend — `CheckIn.tsx`

- Substituir o cálculo hardcoded de `isOpen` (linha 220) e os textos de exibição
  (linhas 484, 521, 731) para usar `checkinSettings` do AppContext, com fallback
  para `08:00–13:30` caso ainda não tenha carregado.
- Garante que a janela exibida ao usuário é sempre a mesma que a enforced.

## Tratamento de erros

- **Edge function:** falha ao ler settings → log de warning + uso dos defaults.
  Nunca retorna erro ao usuário por causa de config.
- **Save no admin:** erro de RLS/validação do banco → alerta com a mensagem; o
  estado não é atualizado.
- **Geolocalização no admin:** permissão negada / timeout → mensagem orientando o
  admin a permitir o GPS ou digitar manualmente.

## Estratégia de branch e deploy

- Todo o trabalho na branch **`preview/checkin-settings`** (base `preview/v3`).
- Migration aplicada e edge function publicada **somente após validação** no
  preview. Produção (`main`) não é afetada.

## Testes

- `npm run build` como gate de compilação (lint tem erros pré-existentes; build é
  o gate real do projeto).
- Teste manual (UAT):
  1. Editar horário/raio/local e salvar → confirmar persistência ao reabrir.
  2. Check-in dentro e fora da janela configurada → comportamento correto.
  3. Check-in dentro e fora do raio configurado → comportamento correto.
  4. Botão "usar minha localização atual" preenche os campos.
  5. Verificar fallback: com a tabela vazia, check-in usa os defaults.
- Verificar que a aba não aparece para não-ADMIN.
