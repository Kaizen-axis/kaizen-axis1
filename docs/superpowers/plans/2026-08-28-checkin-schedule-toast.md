# Feedback flutuante do horário de check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir o resultado do salvamento do horário como toast flutuante sem alterar a altura dos cards das unidades.

**Architecture:** Um componente pequeno e reutilizável controlará apresentação, acessibilidade e fechamento automático do toast. O Painel Admin manterá apenas um feedback ativo e o renderizará fora do fluxo dos cards; salvar outra unidade substituirá a mensagem anterior.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Lucide React, Node test runner com `tsx`, Vite e Vercel.

---

## Estrutura de arquivos

- Criar `src/components/ui/FloatingToast.tsx`: toast fixo, acessível e com fechamento automático.
- Criar `src/components/ui/FloatingToast.test.tsx`: regressão de posição, semântica, mensagem e duração padrão.
- Modificar `src/pages/admin/AdminPanel.tsx`: trocar feedback por unidade por um único toast e remover a mensagem interna dos cards.

### Task 1: Componente de toast flutuante

**Files:**
- Create: `src/components/ui/FloatingToast.test.tsx`
- Create: `src/components/ui/FloatingToast.tsx`

- [ ] **Step 1: Escrever o teste RED do componente**

Criar `src/components/ui/FloatingToast.test.tsx`:

```tsx
import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FLOATING_TOAST_DURATION_MS,
  FloatingToast,
} from './FloatingToast.tsx';

describe('FloatingToast', () => {
  it('renders an accessible fixed success notification', () => {
    const html = renderToStaticMarkup(
      <FloatingToast
        feedback={{ type: 'success', message: 'Horário de Zona Oeste salvo com sucesso.' }}
        onClose={() => undefined}
      />,
    );

    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /fixed top-4 right-4/);
    assert.match(html, /Horário de Zona Oeste salvo com sucesso\./);
    assert.match(html, /border-emerald-500/);
  });

  it('renders errors distinctly and uses a four-second default duration', () => {
    const html = renderToStaticMarkup(
      <FloatingToast
        feedback={{ type: 'error', message: 'Não foi possível salvar.' }}
        onClose={() => undefined}
      />,
    );

    assert.match(html, /border-red-500/);
    assert.equal(FLOATING_TOAST_DURATION_MS, 4_000);
  });
});
```

- [ ] **Step 2: Executar o teste e confirmar a falha esperada**

Run:

```powershell
npx tsx --test src/components/ui/FloatingToast.test.tsx
```

Expected: FAIL porque `FloatingToast.tsx` ainda não existe.

- [ ] **Step 3: Implementar o componente mínimo**

Criar `src/components/ui/FloatingToast.tsx`:

```tsx
import { useEffect } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export type FloatingToastFeedback = {
  type: 'success' | 'error';
  message: string;
};

export const FLOATING_TOAST_DURATION_MS = 4_000;

export function FloatingToast({
  feedback,
  onClose,
}: {
  feedback: FloatingToastFeedback | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!feedback) return;
    const timeoutId = window.setTimeout(onClose, FLOATING_TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [feedback, onClose]);

  if (!feedback) return null;

  const isSuccess = feedback.type === 'success';
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;

  return (
    <div
      className={`fixed top-4 right-4 left-4 sm:left-auto z-[100] sm:w-full sm:max-w-sm flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl backdrop-blur ${
        isSuccess
          ? 'border-emerald-500/50 bg-emerald-950/95 text-emerald-100'
          : 'border-red-500/50 bg-red-950/95 text-red-100'
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon size={18} className="shrink-0" aria-hidden="true" />
      <span>{feedback.message}</span>
    </div>
  );
}
```

- [ ] **Step 4: Executar o teste e confirmar GREEN**

Run:

```powershell
npx tsx --test src/components/ui/FloatingToast.test.tsx
```

Expected: 2 testes PASS e nenhuma falha.

- [ ] **Step 5: Commitar o componente**

```powershell
git add src/components/ui/FloatingToast.tsx src/components/ui/FloatingToast.test.tsx
git diff --cached --check
git commit -m "feat(ui): adiciona toast flutuante acessivel"
```

### Task 2: Integrar o toast ao Painel Admin

**Files:**
- Modify: `src/pages/admin/AdminPanel.tsx`

- [ ] **Step 1: Importar o componente e estabilizar o fechamento**

Alterar o import do React para:

```ts
import React, { useCallback, useEffect, useState } from 'react';
```

Importar o toast:

```ts
import {
  FloatingToast,
  type FloatingToastFeedback,
} from '@/components/ui/FloatingToast';
```

Remover o tipo local `UnitScheduleFeedback` e substituir o estado atual por:

```ts
const [unitScheduleFeedback, setUnitScheduleFeedback] = useState<FloatingToastFeedback | null>(null);
const closeUnitScheduleFeedback = useCallback(() => setUnitScheduleFeedback(null), []);
```

- [ ] **Step 2: Fazer todas as respostas usarem o feedback único**

Nas validações, usar respectivamente:

```ts
setUnitScheduleFeedback({ type: 'error', message: 'Informe horários válidos.' });
```

```ts
setUnitScheduleFeedback({
  type: 'error',
  message: 'O horário final deve ser posterior ao horário inicial.',
});
```

Antes da persistência, limpar o toast anterior:

```ts
setSavingUnitCode(unitCode);
setUnitScheduleFeedback(null);
```

No sucesso e no erro, usar:

```ts
setUnitScheduleFeedback({
  type: 'success',
  message: `Horário de ${unitName} salvo com sucesso.`,
});
```

```ts
setUnitScheduleFeedback({
  type: 'error',
  message: 'Não foi possível salvar. Tente novamente.',
});
```

- [ ] **Step 3: Remover o feedback do fluxo do card**

Dentro de `checkinUnits.map`, remover:

```ts
const feedback = unitScheduleFeedback[unit.code];
```

Remover por completo o bloco:

```tsx
{feedback && (
  <p
    className={`text-xs ${feedback.type === 'success' ? 'text-emerald-500' : 'text-red-400'}`}
    role="status"
    aria-live="polite"
  >
    {feedback.message}
  </p>
)}
```

- [ ] **Step 4: Renderizar o toast fora dos cards**

Logo após a abertura do contêiner principal retornado pelo `AdminPanel`, adicionar:

```tsx
<FloatingToast
  feedback={unitScheduleFeedback}
  onClose={closeUnitScheduleFeedback}
/>
```

Por usar `position: fixed`, o componente não reserva altura no card ou no painel.

- [ ] **Step 5: Verificar integração e regressões**

Run:

```powershell
npx tsx --test src/components/ui/FloatingToast.test.tsx
deno test --no-config src/lib/auth/userRoles.test.ts src/lib/checkin/checkinUi.test.ts supabase/functions/_shared/checkin-policy.test.ts supabase/functions/_shared/checkin-cors.test.ts
deno eval --no-config "import ts from 'npm:typescript@5.8.3'; const f='src/pages/admin/AdminPanel.tsx'; const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if((r.diagnostics??[]).some(d=>d.category===ts.DiagnosticCategory.Error)) Deno.exit(1); console.log('AdminPanel syntax OK');"
rg -n "FloatingToast|setUnitScheduleFeedback" src/pages/admin/AdminPanel.tsx
rg -n "unitScheduleFeedback\[|const feedback = unitScheduleFeedback" src/pages/admin/AdminPanel.tsx
npm run build
git diff --check
```

Expected: teste do toast com 2 PASS; testes focados sem falhas; sintaxe OK; primeira busca encontra integração e setters; segunda busca não encontra resultados; build Vite finaliza com sucesso; `git diff --check` sem erros.

- [ ] **Step 6: Commitar a integração**

```powershell
git add src/pages/admin/AdminPanel.tsx
git diff --cached --check
git commit -m "fix(admin): mostra salvamento de horario em toast"
```

### Task 3: Publicar e verificar o preview

**Files:**
- No source changes expected.

- [ ] **Step 1: Fazer push da branch**

```powershell
git push origin preview/checkin-multiunidade
```

Expected: branch remota atualizada sem force push.

- [ ] **Step 2: Aguardar o deployment da Vercel**

```powershell
npx vercel ls kaizen-axis1 --yes
```

Copiar a URL do deployment mais recente da branch e executar:

```powershell
$deploymentUrl = npx vercel ls kaizen-axis1 --yes 2>&1 |
  Where-Object { $_ -match '^https://kaizen-axis1-[a-z0-9]+-hokma-tech\.vercel\.app$' } |
  Select-Object -First 1
if (-not $deploymentUrl) {
  throw 'Novo deployment de preview não encontrado na listagem da Vercel.'
}
npx vercel inspect $deploymentUrl --wait --timeout 120s --json
npx vercel inspect 'https://kaizen-axis1-git-preview-checkin-multiunidade-hokma-tech.vercel.app' --json
```

Expected: `target: preview`, `readyState: READY` e o alias estável associado ao novo deployment.

- [ ] **Step 3: Conferir Git e entregar para validação visual**

```powershell
$local = (git rev-parse HEAD).Trim()
$remote = ((git ls-remote origin refs/heads/preview/checkin-multiunidade) -split '\s+')[0]
if ($local -ne $remote) { throw 'Hashes local e remoto são diferentes.' }
git status --short --branch
```

Expected: hashes iguais, nenhum arquivo rastreado pendente e arquivos não rastreados preexistentes intactos.

No preview, salvar os dois cards e confirmar que cada mensagem aparece flutuando no canto superior direito, fecha em quatro segundos e não altera a altura dos cards.
