import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type Customer, type PaymentMethod } from '@isp/shared';
import { useDeletePayment, usePayments } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useDebounce } from '@/hooks/useDebounce';
import { CustomerPickerModal } from '@/components/CustomerPickerModal';
import { PaymentModal } from '@/components/PaymentModal';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Input, PageHeader, Pagination, Select, Skeleton, Td, Th } from '@/components/ui';

const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;

export function PaymentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payFor, setPayFor] = useState<Customer | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; receiptNo: string } | null>(null);
  const q = useDebounce(search.trim());
  const del = useDeletePayment();

  const { data, isLoading, isFetching } = usePayments({ q: q || undefined, method: method || undefined, from, to, page, pageSize: 25 });

  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Collections across all customers."
        actions={can('payments:create') && (
          <Button onClick={() => setPickerOpen(true)}>
            <Plus className="size-4" /> Record payment
          </Button>
        )}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[13px] font-medium text-muted">Total in range</p>
          <p className="num mt-2 text-[32px] leading-none font-bold tracking-tight text-accent">{fmtMoney(data?.meta.totalAmount ?? 0)}</p>
          <p className="mt-2 text-xs text-muted">{fmtDate(from)} – {fmtDate(to)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-muted">Payments</p>
          <p className="num mt-2 text-[32px] leading-none font-bold tracking-tight text-strong">{data?.meta.total ?? 0}</p>
          <p className="mt-2 text-xs text-muted">{method ? PAYMENT_METHOD_LABELS[method] : 'All methods'}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-muted">Average payment</p>
          <p className="num mt-2 text-[32px] leading-none font-bold tracking-tight text-strong">
            {fmtMoney(data?.meta.total ? data.meta.totalAmount / data.meta.total : 0)}
          </p>
          <p className="mt-2 text-xs text-muted">Per receipt</p>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row">
          <div className="flex-1">
            <Input placeholder="Search receipt, transaction ID, customer name / phone / code…" leading={<Search className="size-4" />} value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex">
            <Select value={method} onChange={(e) => reset(setMethod)(e.target.value as PaymentMethod | '')} className="lg:w-36" aria-label="Method">
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </Select>
            <Input type="date" numeric value={from} max={to} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="From date" />
            <Input type="date" numeric value={to} min={from} onChange={(e) => reset(setTo)(e.target.value)} aria-label="To date" />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.data.length ? (
          <EmptyState icon={<CreditCard className="size-6" />} title="No payments found" message="Try another date range or search." />
        ) : (
          <div className={isFetching ? 'opacity-70' : undefined}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-hairline">
                  <tr><Th>Receipt</Th><Th>Customer</Th><Th>Paid at</Th><Th>Method</Th><Th>Period</Th><Th>Collected by</Th><Th align="right">Amount</Th><Th /></tr>
                </thead>
                <tbody>
                  {data.data.map((p) => (
                    <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-surface-2/50">
                      <Td className="num whitespace-nowrap text-strong">{p.receiptNo}</Td>
                      <Td>
                        <Link to={`/customers/${p.customerId}`} className="font-medium text-strong hover:text-accent">{p.customer?.name}</Link>
                        <p className="num text-xs text-muted">{p.customer?.customerCode} · {p.customer?.phone}</p>
                      </Td>
                      <Td className="num whitespace-nowrap text-muted-strong">{fmtDateTime(p.paidAt)}</Td>
                      <Td>
                        <span className="text-muted-strong">{PAYMENT_METHOD_LABELS[p.method]}</span>
                        {p.transactionId && <p className="num text-xs text-muted">{p.transactionId}</p>}
                      </Td>
                      <Td className="num text-xs whitespace-nowrap text-muted">{p.periodFrom ? `${fmtDate(p.periodFrom)} → ${fmtDate(p.periodTo)}` : '—'}</Td>
                      <Td className="text-muted-strong">{p.collectedBy?.name ?? '—'}</Td>
                      <Td align="right" className="num font-semibold whitespace-nowrap text-up">+{fmtMoney(p.amount)}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <IconButton label="Print receipt" onClick={() => navigate(`/payments/${p.id}/receipt`)}><Printer className="size-4" /></IconButton>
                          {can('payments:delete') && (
                            <IconButton label="Delete payment" className="hover:text-down" onClick={() => setToDelete({ id: p.id, receiptNo: p.receiptNo })}><Trash2 className="size-4" /></IconButton>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPage={setPage} />
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        danger
        loading={del.isPending}
        title="Delete payment?"
        confirmLabel="Delete"
        message={`Delete payment ${toDelete?.receiptNo}? If it is the customer's latest renewal, their expiry date is rolled back.`}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Payment deleted');
            setToDelete(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      {can('payments:create') && (
        <>
          <CustomerPickerModal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onPick={(c) => {
              setPickerOpen(false);
              setPayFor(c);
            }}
            title="Record payment"
            subtitle="Choose the customer who paid. Search by name, phone, code, PPPoE username or RADIUS ID."
          />
          {payFor && <PaymentModal key={payFor.id} customer={payFor} open onClose={() => setPayFor(null)} />}
        </>
      )}
    </div>
  );
}
