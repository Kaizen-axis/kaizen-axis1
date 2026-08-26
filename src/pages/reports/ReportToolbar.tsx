import { SearchableBroker } from '@/lib/reports/rankBrokers';
import { BrokerSearch } from './BrokerSearch';
import { FilterMenu } from './FilterMenu';
import { ReportActionsMenu } from './ReportActionsMenu';

interface ReportToolbarProps {
  brokers?: SearchableBroker[];
  onSelectBroker?: (broker: SearchableBroker) => void;
  period: string;
  onPeriodChange: (period: string) => void;
  onDownloadPdf: () => void;
  pdfLabel: string;
  pdfLoading: boolean;
  pdfDisabled?: boolean;
}

export function ReportToolbar({
  brokers,
  onSelectBroker,
  period,
  onPeriodChange,
  onDownloadPdf,
  pdfLabel,
  pdfLoading,
  pdfDisabled,
}: ReportToolbarProps) {
  const hasSearch = !!(brokers && onSelectBroker);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
      {hasSearch ? (
        <div className="flex-1 min-w-0">
          <BrokerSearch brokers={brokers!} onSelect={onSelectBroker!} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <FilterMenu period={period} onPeriodChange={onPeriodChange} />
      <ReportActionsMenu label={pdfLabel} onDownloadPdf={onDownloadPdf} pdfLoading={pdfLoading} disabled={pdfDisabled} />
    </div>
  );
}
