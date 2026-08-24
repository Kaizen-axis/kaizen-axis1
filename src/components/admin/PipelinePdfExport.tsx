// Shim de compatibilidade: o componente vive em src/components/reports/.
// Mantido porque snapshots antigos do projeto (kaizen-axis1/, kaizen-axis-saas-template-v2/)
// são incluídos pelo tsconfig e importam este caminho via alias "@/".
export { default } from '@/components/reports/PipelinePdfExport';
