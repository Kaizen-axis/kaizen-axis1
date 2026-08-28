# Plataforma self-hosted ImobKaizen — desenho de migração

**Data:** 2026-08-28  
**Status:** desenho aprovado em conversa  
**Escopo:** site institucional, Kaizen Axis, duas stacks Supabase, Cloudflare, Mailcow, Resend, deploy, backup e observabilidade

## 1. Objetivo

Migrar os dois produtos da empresa de Vercel e Supabase gerenciado para a VPS existente, preservando os dados e mantendo os serviços atuais disponíveis até que cada substituto seja validado:

- site institucional em `https://imobkaizen.com.br`;
- Kaizen Axis em `https://app.imobkaizen.com.br`;
- uma stack Supabase self-hosted exclusiva para cada produto;
- Mailcow único e multi-domínio para `hokmatech.com` e `imobkaizen.com.br`;
- Resend isolado em subdomínio para e-mails transacionais;
- entrada HTTP protegida por Cloudflare Tunnel, WAF e controles de acesso;
- backups externos no Cloudflare R2 e procedimentos de restauração testados.

O objetivo econômico é remover os custos recorrentes de Vercel e dos dois projetos Supabase gerenciados sem trocar esses custos por risco operacional não controlado.

## 2. Baselines imutáveis de produção

Os builds da migração devem partir dos commits efetivamente promovidos na Vercel, nunca do nome móvel de uma branch.

| Produto | Deployment Vercel | Branch de origem | Commit imutável |
|---|---|---|---|
| Site institucional | `dpl_J5VzdWUmiA4EWmyDuLzpFyjsmEK9` | `preview-landing-dark` | `2691097301d7efc1d8d1057c3981594bd72bb3b3` |
| Kaizen Axis | `dpl_4LhrHhWjJZmFPgNs2NueWzUWnHqV` | `preview/checkin-multiunidade` | `10c8f8b6f7e61cb008fe1a1eab62148a614d059d` |

Antes do primeiro build, cada repositório recebe uma tag protegida de baseline. O pipeline registra SHA, digest da imagem, lockfile, versão do Node e conjunto de nomes das variáveis de ambiente. Valores secretos não entram em Git, logs ou artefatos públicos.

## 3. Estado atual confirmado

### 3.1 Aplicações

- O site é Next.js 16.2.7, usa SSR/middleware, Supabase Auth e a tabela/bucket dos imóveis.
- O Axis é uma PWA Vite/React, usa Supabase Auth, PostgREST, RLS/RPC, Realtime, Storage e 16 Edge Functions.
- O Axis também possui a função Node `/api/apuracao`, hoje executada como função Vercel com até 2 GB de memória e 300 segundos.
- Os projetos Supabase gerenciados são distintos:
  - Axis: `pwvpxxrvlywlneuijmmd`;
  - site: `sngxzveittfaacdbovyu`.

### 3.2 VPS

- Ubuntu 24.04.4 LTS, Docker 29.5.3 e Coolify já operacionais.
- Aproximadamente 47 GiB de RAM, 39 GiB disponíveis no levantamento e 179 GiB livres em disco.
- Gitea, registry/runner, MinIO, Vaultwarden, Uptime Kuma, Mailcow e outros serviços já estão em execução.
- `cloudflared` ainda não está ativo.
- O firewall bloqueia entrada por padrão, mas as portas HTTP/HTTPS, e-mail, Gitea SSH e LiveKit possuem exceções públicas.

### 3.3 DNS e e-mail

- `imobkaizen.com.br` usa nameservers da HostGator.
- O apex e `www` atendem o site pela Vercel.
- `app.imobkaizen.com.br` ainda não existe.
- O Mailcow usa `MAILCOW_HOSTNAME=mail.hokmatech.com`.
- O PTR/HELO canônico deve continuar em `mail.hokmatech.com`.

## 4. Escopo e limites

### Incluído

- migração independente dos dois bancos, usuários Auth e objetos Storage;
- migração das configurações Auth, RLS, RPC, triggers, extensões, Realtime e Functions;
- empacotamento dos dois aplicativos para Docker;
- separação de frontend e API do Axis;
- migração da zona DNS para Cloudflare;
- Cloudflare Tunnel e segurança HTTP;
- domínio `imobkaizen.com.br` no Mailcow;
- Resend para e-mails do app e autenticação;
- backup, monitoração, validação e rollback.

### Não incluído nesta primeira entrega

- segunda VPS ou cluster de alta disponibilidade;
- mistura dos dois produtos em um único banco;
- substituição do Resend pelo Mailcow para e-mails transacionais;
- cancelamento automático de Vercel ou Supabase;
- criação indiscriminada de caixas postais. A inclusão do domínio no Mailcow não cria caixas além das que forem solicitadas explicitamente.

## 5. Arquitetura de destino

```text
Internet
   |
Cloudflare DNS + WAF + DDoS + Rate Limiting
   |
Cloudflare Tunnel
   |-- imobkaizen.com.br / www
   |      `-- site Next.js
   |             `-- Supabase Site
   |                  |-- Postgres
   |                  |-- Auth + REST
   |                  `-- Storage de imóveis
   |
   |-- app.imobkaizen.com.br
   |      |-- frontend PWA Axis
   |      `-- API Node /api/apuracao
   |             `-- Supabase Axis
   |                  |-- Postgres
   |                  |-- Auth + REST + Realtime
   |                  |-- Storage
   |                  `-- Edge Functions
   |
   `-- Cloudflare Access
          |-- Studio Site
          |-- Studio Axis
          `-- painéis administrativos

SMTP/IMAP direto e DNS-only --> Mailcow multi-domínio
E-mail transacional ---------> Resend / notify.imobkaizen.com.br
Backups criptografados ------> Cloudflare R2
```

As duas stacks Supabase compartilham somente a infraestrutura física. Cada uma possui projeto Docker Compose, rede, banco, volumes, buckets, chaves JWT, publishable/secret keys, credenciais S3 e políticas de backup próprios. O backend primário de objetos usa o MinIO da VPS com buckets e credenciais de menor privilégio separados por produto; a cópia externa usa buckets R2 também separados. Nenhuma porta PostgreSQL é publicada na internet.

## 6. Hostnames e responsabilidades

| Hostname | Destino | Exposição |
|---|---|---|
| `imobkaizen.com.br` | site Next.js | Tunnel, público |
| `www.imobkaizen.com.br` | redirecionamento canônico para apex | Cloudflare |
| `app.imobkaizen.com.br` | PWA Axis e API sob o mesmo origin | Tunnel, público |
| `api-site.imobkaizen.com.br` | gateway Supabase Site | Tunnel, público para clientes autorizados |
| `api-app.imobkaizen.com.br` | gateway Supabase Axis | Tunnel, público para clientes autorizados |
| `studio-site.imobkaizen.com.br` | Studio Site | Tunnel + Access |
| `studio-app.imobkaizen.com.br` | Studio Axis | Tunnel + Access |
| `webmail.imobkaizen.com.br` | interface Mailcow | Tunnel, público com WAF |
| `mail.imobkaizen.com.br` | nome adicional SMTP/IMAP | DNS-only |
| `mail.hokmatech.com` | hostname canônico Mailcow, MX e PTR | DNS-only |
| `notify.imobkaizen.com.br` | envio transacional Resend | registros DNS de e-mail, sem proxy |
| `kaizen-axis.space` | compatibilidade temporária do Axis | mesmo app e depois redirect |

O gateway Supabase precisa ser alcançável pelos navegadores, mas apenas por HTTPS e sem expor Postgres. Studios e painéis de infraestrutura recebem uma segunda barreira de autenticação pelo Cloudflare Access.

## 7. Deploy e promoção

### 7.1 Imagens

- Site: imagem Node multi-stage para Next.js standalone/SSR.
- Axis frontend: imagem estática com configuração de produção compilada para o novo Supabase.
- Axis API: serviço Node próprio para `/api/apuracao`, com limites de corpo, tempo e memória equivalentes ou superiores aos observados na Vercel.
- Supabase: duas composições oficiais self-hosted com todas as imagens fixadas por versão ou digest.

Arquivos `*.test.*` permanecem no CI e não são publicados como rotas. Isso corrige o comportamento atual da Vercel, que empacota testes dentro de `api/` como funções.

### 7.2 Pipeline

1. Gitea Actions obtém o commit fixado.
2. Executa lint, testes, build, SBOM e varredura de vulnerabilidades.
3. Publica imagem com tag do SHA e registra o digest.
4. Implanta primeiro em staging.
5. Testes de fumaça e funcionais bloqueiam promoção.
6. A produção recebe exatamente o digest aprovado.

Push em branch não promove produção automaticamente. O Coolify recebe uma promoção manual e auditável. Cloudflare Tunnel é o caminho de entrada, não o mecanismo de deploy.

## 8. Segurança Cloudflare e de origem

- Migrar a zona DNS copiando e comparando todos os registros antes de trocar nameservers.
- Manter Vercel e Supabase como destinos durante a propagação inicial da zona.
- Ativar WAF gerenciado, proteção DDoS e regras customizadas por hostname/caminho.
- Aplicar rate limits distintos para login, reset de senha, APIs e Functions.
- Manter Turnstile nos fluxos de autenticação.
- Usar Access nos Studios, Coolify e painéis internos; não colocar o app público inteiro atrás de Access.
- Permitir WebSocket no endpoint Realtime.
- Armazenar em cache somente conteúdo estático. Auth, REST, Realtime, Storage, Functions e `/api` nunca usam cache compartilhado.
- Ativar HSTS apenas depois da validação de todos os hostnames e certificados.
- Não aplicar mTLS a chamadas originadas em navegador. mTLS/service tokens ficam restritos a integrações máquina a máquina.
- Fechar as entradas HTTP das aplicações após validar o Tunnel. Portas de e-mail, Gitea SSH e mídia LiveKit permanecem tratadas separadamente.

## 9. Mailcow e Resend

Haverá uma única instalação Mailcow com dois domínios de e-mail. Duas instalações no mesmo IP não são usadas porque disputariam as portas SMTP/IMAP e exigiriam IPs/PTRs distintos.

### Mailcow

- preservar `MAILCOW_HOSTNAME=mail.hokmatech.com`;
- adicionar `imobkaizen.com.br` como domínio;
- adicionar `mail.imobkaizen.com.br` a `ADDITIONAL_SAN` e `ADDITIONAL_SERVER_NAMES`;
- manter MX de `imobkaizen.com.br` apontando para `mail.hokmatech.com`;
- publicar `autodiscover` e `autoconfig`;
- gerar DKIM próprio para `imobkaizen.com.br`;
- iniciar DMARC em observação, verificar relatórios e só então avançar para `quarantine`/`reject`;
- usar DNS-01 com token Cloudflare de menor privilégio para certificados;
- manter SMTP/IMAP DNS-only; servir a interface web por hostname `webmail.*` no Tunnel.

### Resend

- verificar `notify.imobkaizen.com.br` como domínio transacional separado;
- publicar SPF, DKIM e return-path gerados pelo Resend nesse subdomínio;
- não criar MX de recebimento Resend no apex;
- usar endereço de resposta real no Mailcow;
- desativar tracking em mensagens de autenticação para não interferir nos links;
- configurar o SMTP do Auth e as Edge Functions com credenciais novas/rotacionadas.

## 10. Migração de dados

Os projetos são migrados de forma sequencial, começando pelo site, que funciona como piloto operacional.

### 10.1 Pré-voo por projeto

1. Inventariar versão PostgreSQL, extensões, schemas, roles, tabelas, políticas, funções, triggers, publicações Realtime, usuários, providers Auth, templates, secrets, buckets e objetos.
2. Medir banco, Storage e crescimento mensal.
3. Criar a stack de destino compatível com a versão e as extensões realmente usadas.
4. Fazer dump separado de roles, schema e dados com a Supabase CLI.
5. Copiar objetos Storage de modo verificável e idempotente.
6. Recriar configurações que não viajam no dump: Auth, SMTP, URLs, Functions, secrets, Realtime e DNS.

### 10.2 Ensaios

Cada projeto passa por pelo menos um restore integral em staging. Contagens, checksums, usuários, arquivos e fluxos são comparados. O tempo do dump final, restore, delta de Storage e validação deve caber em 30 minutos antes de autorizar o corte. Se o ensaio exceder esse limite, o corte é bloqueado até haver uma janela maior aprovada ou um desenho separado de replicação contínua.

### 10.3 Corte do site

- bloquear somente escrita no painel administrativo;
- manter páginas públicas atendidas pela Vercel;
- executar dump/restore final e delta de imagens;
- validar login administrativo, CRUD e Storage;
- trocar a rota Cloudflare para o container Next.js;
- reabrir escrita depois da aprovação dos testes.

### 10.4 Corte do Axis

- ativar modo somente leitura por 15–30 minutos;
- executar dump/restore final e delta de objetos;
- implantar frontend/API com `api-app.imobkaizen.com.br`;
- validar os fluxos críticos antes de reabrir escrita;
- exigir novo login. A migração preserva usuários e senhas, mas não promete preservar tokens emitidos pelo projeto gerenciado.

## 11. Validação obrigatória

### Site

- contagem e conteúdo de imóveis;
- hashes/quantidade das imagens;
- listagem, busca, filtros e detalhes;
- SSR e middleware;
- login, Turnstile e sessão administrativa;
- criar, editar, excluir e publicar imóvel;
- upload e remoção de imagens.

### Axis

- login e autorização dos cinco perfis;
- RLS e isolamento por equipe/diretoria;
- clientes, agenda, tarefas, comissões e relatórios;
- documentos e URLs assinadas;
- chat, Realtime, notificações e push;
- check-in, QR, geolocalização e horários;
- Edge Functions, leads e integrações;
- Resend e recuperação de senha;
- `/api/apuracao`, PDFs e rate limiting;
- instalação/atualização da PWA e uso mobile.

### Infraestrutura e segurança

- endpoints healthy não bastam: testes autenticados e não autenticados são obrigatórios;
- WAF não pode bloquear uploads, WebSockets ou APIs legítimas;
- CORS aceita somente os origins previstos;
- service/secret keys nunca aparecem no frontend;
- Access permite administradores e nega usuários não autorizados;
- SPF, DKIM e DMARC passam nos validadores;
- envio e recebimento Mailcow e envio Resend são testados separadamente;
- backup precisa ser restaurado, não apenas criado.

## 12. Rollback e retenção dos serviços antigos

Durante a janela somente leitura, qualquer divergência ou falha crítica causa retorno da rota para Vercel/Supabase. A escrita só é reaberta depois de todos os gates passarem.

Depois que a escrita começa na VPS, rollback deixa de ser apenas uma troca de DNS: os novos dados precisam ser reconciliados com o ambiente antigo. Por isso:

- os serviços antigos permanecem intactos e sem novas escritas por pelo menos sete dias;
- nenhum plano é cancelado sem backup final e autorização explícita;
- mudanças de rota ficam documentadas e reversíveis;
- incidentes depois da reabertura seguem procedimento de exportação do delta antes de qualquer retorno.

`kaizen-axis.space` atende o novo app durante um período de transição, exibe aviso sobre o novo endereço/PWA e depois redireciona caminhos e parâmetros para `app.imobkaizen.com.br`.

## 13. Backup e recuperação

- backup PostgreSQL completo, incrementais e arquivamento contínuo de WAL para R2;
- buckets/prefixos R2 separados por produto e ambiente;
- sincronização dos objetos MinIO para R2;
- criptografia de backups antes do envio e chaves fora do servidor de origem;
- retenção inicial de 30 dias diários e seis cópias mensais;
- teste mensal de restauração de cada projeto;
- objetivo inicial de RPO de até 15 minutos e RTO de até quatro horas.

Cloudflare e R2 não tornam a VPS altamente disponível. Uma segunda VPS/replica é a evolução necessária para tolerar perda do host sem tempo de restauração.

## 14. Observabilidade e operação

- métricas de CPU, RAM, disco, I/O, Docker, Postgres, conexões, WAL e filas;
- health checks para gateway, Auth, REST, Realtime, Storage, Functions e aplicações;
- Uptime Kuma para dependências e fluxos internos;
- monitor externo à VPS para detectar perda total do host;
- alertas de backup, certificado, disco, container, autenticação e erro HTTP;
- logs centralizados com retenção e acesso restrito;
- atualização de imagens primeiro em staging, com changelog e rollback por digest;
- teste de restauração e exercício de incidente no calendário operacional.

## 15. Sequência de rollout

1. Congelar e etiquetar os dois baselines de produção.
2. Inventariar dados, Storage, configurações e dependências.
3. Copiar a zona para Cloudflare mantendo destinos atuais.
4. Trocar nameservers e validar site/e-mail sem mudar hospedagem.
5. Configurar Mailcow multi-domínio, DNS de e-mail e Resend.
6. Criar Tunnel, políticas, staging, backups e observabilidade.
7. Instalar e endurecer as duas stacks Supabase.
8. Empacotar e testar os dois aplicativos pelos SHAs fixados.
9. Executar ensaios integrais de migração e restauração.
10. Migrar o site institucional.
11. Observar e corrigir o site antes de avançar.
12. Migrar o Axis em modo somente leitura.
13. Observar por pelo menos sete dias.
14. Fazer backup final e desativar serviços antigos somente após autorização.

## 16. Credenciais e autorizações

### Confirmadas

- VPS por SSH, `sudo` e Docker;
- projetos/deployments Vercel e autenticação da equipe;
- repositórios Git dos dois produtos;
- Gitea e Mailcow documentados no cofre local;
- credenciais R2 documentadas;
- credenciais HostGator e referência Resend presentes na documentação local;
- token Cloudflare capaz de consultar a zona `hokmatech.com`.

### Ainda exigem validação interativa antes da execução

- acesso administrativo aos projetos Supabase `pwvpxxrvlywlneuijmmd` e `sngxzveittfaacdbovyu`;
- senhas/conexões de banco necessárias aos dumps completos;
- permissão Cloudflare para adicionar `imobkaizen.com.br`, criar Tunnel, Access, WAF e tokens DNS-01;
- acesso ao registrador/HostGator com autoridade para trocar nameservers;
- acesso Resend para criar/rotacionar chave e verificar o subdomínio.

A sessão Supabase CLI encontrada no dispositivo lista outros projetos, não os dois alvos. O token Cloudflare atual enxerga apenas `hokmatech.com`. Portanto, a execução é tecnicamente realizável, mas pode exigir que o proprietário autentique essas contas uma vez. Senhas e códigos 2FA não devem ser enviados pelo chat.

## 17. Critérios de conclusão

- os dois aplicativos atendem exclusivamente pelos domínios finais e pelos artefatos dos SHAs fixados;
- os dois projetos usam stacks Supabase isoladas na VPS;
- contagens, checksums e objetos passam nas reconciliações;
- fluxos funcionais e de segurança passam nos testes definidos;
- Mailcow recebe e envia por `imobkaizen.com.br` com autenticação DNS válida;
- Resend envia pelo subdomínio transacional;
- Postgres e painéis não ficam expostos diretamente;
- backups externos são restaurados com sucesso;
- monitoração externa e alertas estão ativos;
- Vercel/Supabase antigos só são desativados após sete dias estáveis, backup final e autorização explícita.

## 18. Referências técnicas

- [Supabase self-hosted com Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Restaurar projeto gerenciado em self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Diferenças e responsabilidades do self-hosted](https://supabase.com/docs/guides/self-hosting)
- [Edge Functions self-hosted](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Roteamento de aplicações pelo Tunnel](https://developers.cloudflare.com/tunnel/routing/)
- [Mailcow — DNS](https://docs.mailcow.email/getstarted/prerequisite-dns/)
- [Mailcow — nomes adicionais e reverse proxy](https://docs.mailcow.email/post_installation/reverse-proxy/r_p/)
- [Resend — verificação de domínios](https://resend.com/docs/dashboard/domains/introduction)
