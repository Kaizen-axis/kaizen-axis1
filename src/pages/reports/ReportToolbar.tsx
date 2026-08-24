import { SearchableBroker } from '@/lib/reports/rankBrokers';
import { BrokerSearch } from './BrokerSearch';
import { ReportActionsMenu } from './ReportActionsMenu';

interface ReportToolbarProps {
  brokers: SearchableBroker[];
  onSelectBroker: (broker: SearchableBroker) => void;
  onDownloadPdf: () => void;
  pdfLabel: string;
  pdfLoading: boolean;
  pdfDisabled?: boolean;
}

export function ReportToolbar({ brokers, onSelectBroker, onDownloadPdf, pdfLabel, pdfLoading, pdfDisabled }: ReportToolbarProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="w-full sm:max-w-sm">
        <BrokerSearch brokers={brokers} onSelect={onSelectBroker} />
      </div>
      <ReportActionsMenu label={pdfLabel} onDownloadPdf={onDownloadPdf} pdfLoading={pdfLoading} disabled={pdfDisabled} />
    </div>
  );
}
