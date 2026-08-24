// ─── Centralized BI Report Types ─────────────────────────────────────────────

/** Stage probability weights for the Weighted Pipeline calculation */
export const STAGE_WEIGHTS: Record<string, number> = {
    'Novo Lead': 0.10,
    'Documentação': 0.15,
    'Em Análise': 0.20,
    'Condicionado': 0.40,
    'Em Tratativa': 0.50,
    'Contrato': 0.70,
    'Aprovado': 0.85,
    'Concluído': 1.00,
    'Desistência': 0.00,
    'Reprovado': 0.00,
};

/** Global aggregated metrics shown on the main reports page */
export interface GlobalMetrics {
    totalVendas: number;
    novosLeads: number;
    taxaConversao: number;   // percentage 0-100
    cicloMedioDias: number;  // real average from closed_at - created_at
}

/** Monthly data point for the Weighted Pipeline forecast chart */
export interface WeightedPipelineEntry {
    month: string;           // 'Jan', 'Fev', …
    weighted: number;        // weighted pipeline value in thousands (R$ k)
    confirmed: number;       // confirmed (Concluído only) in thousands
}

/** Per-client health score for risk/probability section */
export interface ClientHealthScore {
    id: string;
    name: string;
    stage: string;
    score: number;                   // 0-100
    potentialValue: string;          // formatted BRL string
    conversionProbability: number;   // 0-100 (same as score)
}

/** Summary returned from the get_relatorio_diretoria RPC */
export interface DiretoriaResumo {
    total_clientes: number;
    total_vendas: number;
    total_aprovados: number;
    taxa_conversao: number;
    receita_total: number;
    ciclo_medio_dias: number;
}

export interface DiretoriaEquipe {
    equipe_id: string;
    equipe_nome: string;
    total_clientes: number;
    total_vendas: number;
}

export interface DiretoriaCorretor {
    corretor_id: string;
    corretor_nome: string;
    equipe: string;
    total_clientes: number;
    total_vendas: number;
}

export interface DiretoriaReport {
    diretoria_nome: string;
    resumo: DiretoriaResumo;
    equipes: DiretoriaEquipe[];
    corretores: DiretoriaCorretor[];
}
