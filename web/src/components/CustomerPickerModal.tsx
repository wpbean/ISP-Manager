import { useEffect, useState } from 'react';
import { ChevronRight, Search, Users } from 'lucide-react';
import type { Customer } from '@isp/shared';
import { useCustomers } from '@/lib/queries';
import { fmtMoney } from '@/lib/format';
import { useDebounce } from '@/hooks/useDebounce';
import { EmptyState, ExpiryText, Input, Modal, Skeleton, StatusBadge } from '@/components/ui';

/** Search and pick one customer (e.g. to record a payment from the Payments page). */
export function CustomerPickerModal({
  open,
  onClose,
  onPick,
  title = 'Select customer',
  subtitle = 'Search by name, phone, customer code, PPPoE username or RADIUS ID.',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (customer: Customer) => void;
  title?: string;
  subtitle?: string;
}) {
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim());

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const { data, isLoading, isFetching } = useCustomers({ q: q || undefined, page: 1, pageSize: 8, sort: 'name', order: 'asc' });

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="space-y-3">
        <Input
          autoFocus
          placeholder="Search customers…"
          leading={<Search className="size-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search customers"
        />

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !data?.data.length ? (
          <EmptyState icon={<Users className="size-6" />} title="No customers found" message="Try another name, phone or code." />
        ) : (
          <ul className={isFetching ? 'divide-y divide-hairline opacity-70' : 'divide-y divide-hairline'}>
            {data.data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-strong">{c.name}</p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="num mt-0.5 truncate text-xs text-muted">
                      {c.customerCode} · {c.phone} · {c.packageSpeed} · {fmtMoney(c.monthlyFee)}/mo
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[13px]">
                    <ExpiryText date={c.expireDate} />
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && data.meta.total > data.data.length && (
          <p className="num text-xs text-muted">Showing {data.data.length} of {data.meta.total} — refine your search to narrow down.</p>
        )}
      </div>
    </Modal>
  );
}
