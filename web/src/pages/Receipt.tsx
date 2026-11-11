import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@isp/shared';
import { usePayment } from '@/lib/queries';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { Button, EmptyState, PageLoader } from '@/components/ui';
import { Logo } from '@/components/layout/Logo';

/** Printable receipt — always light (transactional surface per design.md). */
export function ReceiptPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, isLoading } = usePayment(id);

  if (isLoading) return <PageLoader />;
  if (!p) return <EmptyState title="Receipt not found" />;

  const rows: [string, string][] = [
    ['Customer', p.customer?.name ?? '—'],
    ['Customer code', p.customer?.customerCode ?? '—'],
    ['Phone', p.customer?.phone ?? '—'],
    ['Address', p.customer?.address ?? '—'],
    ['Package', p.customer?.packageSpeed ?? '—'],
    ['Service period', p.periodFrom ? `${fmtDate(p.periodFrom)} – ${fmtDate(p.periodTo)}` : 'No renewal'],
    ['Payment method', `${PAYMENT_METHOD_LABELS[p.method]}${p.transactionId ? ` · ${p.transactionId}` : ''}`],
    ['Collected by', p.collectedBy?.name ?? '—'],
  ];

  return (
    <div data-theme="light" className="min-h-full bg-canvas px-4 py-8 text-text print:bg-white print:p-0">
      <div className="no-print mx-auto mb-6 flex max-w-xl items-center justify-between">
        <Button variant="secondary" onClick={() => navigate(-1)}><ArrowLeft className="size-4" /> Back</Button>
        <Button onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
      </div>
      <div className="mx-auto max-w-xl rounded-xl border border-hairline bg-white p-8 print:border-0">
        <div className="flex items-start justify-between">
          <Logo />
          <div className="text-right">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Payment receipt</p>
            <p className="num mt-1 text-sm font-semibold text-strong">{p.receiptNo}</p>
            <p className="num text-xs text-muted">{fmtDateTime(p.paidAt)}</p>
          </div>
        </div>
        <div className="my-8 rounded-lg bg-surface-2 px-6 py-6 text-center">
          <p className="text-xs text-muted">Amount paid</p>
          <p className="num mt-1 text-[40px] leading-tight font-bold tracking-tight text-strong">{fmtMoney(p.amount)}</p>
          {p.months > 0 && <p className="mt-1 text-xs text-muted">{p.months} month{p.months > 1 ? 's' : ''} of service</p>}
        </div>
        <dl className="divide-y divide-hairline text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-6 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd className="num text-right text-strong">{v}</dd>
            </div>
          ))}
        </dl>
        {p.note && <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-muted-strong">{p.note}</p>}
        <p className="mt-8 text-center text-xs text-muted">Thank you for your payment.</p>
      </div>
    </div>
  );
}
