# Feedback flutuante ao salvar horário de check-in — Design

**Data:** 2026-08-28
**Branch:** `preview/checkin-multiunidade`

## Objetivo

Substituir o feedback exibido dentro do card de horário por uma notificação
flutuante. Salvar ou validar um horário não deve alterar a altura nem o
alinhamento dos cards das unidades.

## Comportamento

- O Painel Admin exibirá um único toast fixo no canto superior direito.
- Sucesso exibirá `Horário de Zona Oeste salvo com sucesso.` ou
  `Horário de Zona Norte salvo com sucesso.` em verde.
- Erros de validação ou persistência serão exibidos no mesmo toast em vermelho.
- O toast desaparecerá automaticamente após quatro segundos.
- Uma nova mensagem substituirá imediatamente a anterior.
- A notificação terá `role="status"` e `aria-live="polite"`.
- Nenhuma mensagem de feedback será renderizada dentro do card.

## Implementação

O estado atual, indexado por código de unidade, será substituído por um único
estado opcional com `type` e `message`. O toast será renderizado fora do fluxo
dos cards, com `position: fixed` e `z-index` suficiente para permanecer visível
acima do Painel Admin. Um efeito controlará o fechamento automático e limpará o
temporizador ao substituir a mensagem ou desmontar a página.

## Verificação

1. Salvar Zona Oeste e confirmar o toast sem mudança na altura do card.
2. Salvar Zona Norte e confirmar que a mensagem identifica a unidade correta.
3. Informar uma janela inválida e confirmar o toast de erro.
4. Confirmar fechamento automático após quatro segundos.
5. Confirmar build e testes focados antes do push da branch de preview.
