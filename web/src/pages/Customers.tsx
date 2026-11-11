import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Download, Plus, Search, Upload, Users } from 'lucide-react';
import { toast } from 'sonner';
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerListQuery, type CustomerStatus } from '@isp/shared';
import { useAreas, useCustomers, useDashboard } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { downloadFile, errorMessage } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useDebounce } from '@/hooks/useDebounce';
import { ImportModal } from '@/components/ImportModal';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ExpiryText,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
  Td,
  Th,
} from '@/components/ui';

type TabValue = 'ALL' | CustomerStatus;

export function CustomersPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useDebounce(search.trim(), 300);

  const status = (params.get('status') as TabValue | null) ?? 'ALL';
  const expiry = (params.get('expiry') ?? '') as CustomerListQuery['expiry'] | '';
  const area = params.get('area') ?? '';
  const page = Number(params.get('page') ?? 1);
  const sort = (params.get('sort') ?? 'createdAt') as CustomerListQuery['sort'];

  const update = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === 'ALL') next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query: Partial<CustomerListQuery> = {
    q: q || undefined,
    status: status === 'ALL' ? undefined : status,
    expiry: expiry || undefined,
    area: area || undefined,
    page,
    pageSize: 20,
    sort,
    order: sort === 'name' || sort === 'expireDate' || sort === 'customerCode' ? 'asc' : 'desc',
  };
  const { data, isLoading, isFetching } = useCustomers(query);
  const { data: stats } = useDashboard();
  const { data: areas } = useAreas();

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/customers/export', { ...query, page: undefined, pageSize: undefined, sort: undefined, order: undefined });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const tabs: { value: TabValue; label: string; count?: number }[] = [
    { value: 'ALL', label: 'All', count: stats?.customers.total },
    ...CUSTOMER_STATUSES.map((s) => ({
      value: s as TabValue,
      label: CUSTOMER_STATUS_LABELS[s],
      count: stats?.customers[s.toLowerCase() as 'active'],
    })),
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Search, filter and manage every connection on your network."
        actions={
          <>
            {can('customers:import') && (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" /> Import
              </Button>
            )}
            {can('customers:export') && (
              <Button variant="secondary" onClick={exportCsv} loading={exporting}>
                <Download className="size-4" /> Export
              </Button>
            )}
            {can('customers:create') && (
              <Button onClick={() => navigate('/customers/new')}>
                <Plus className="size-4" /> Add Customer
              </Button>
            )}
          </>
        }
      />

      <Card>
        <div className="px-6 pt-4">
          <Tabs value={status} onChange={(v) => update({ status: v })} items={tabs} />
        </div>

        <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center">
          <div className="flex-1">
            <Input
              placeholder="Search name, phone, code, RADIUS ID, PPPoE, ONU serial, address…"
              leading={<Search className="size-4" />}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (page !== 1) update({ page: undefined });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex">
            <Select value={expiry} onChange={(e) => update({ expiry: e.target.value })} className="md:w-40" aria-label="Expiry filter">
              <option value="">Any expiry</option>
              <option value="expiring">Expiring ≤ 7d</option>
              <option value="expired">Expired</option>
              <option value="valid">Valid</option>
            </Select>
            <Select value={area} onChange={(e) => update({ area: e.target.value })} className="md:w-40" aria-label="Area filter">
              <option value="">All areas</option>
              {areas?.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
            <div className="col-span-2 md:col-span-1">
            <Select value={sort} onChange={(e) => update({ sort: e.target.value })} className="md:w-44" aria-label="Sort">
              <option value="createdAt">Newest first</option>
              <option value="name">Name A–Z</option>
              <option value="customerCode">Customer code</option>
              <option value="expireDate">Expiry (soonest)</option>
              <option value="monthlyFee">Highest fee</option>
            </Select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : !data?.data.length ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title="No customers found"
            message={q || status !== 'ALL' || expiry || area ? 'Try changing your search or filters.' : 'Add your first customer to get started.'}
            action={can('customers:create') && !q ? <Button onClick={() => navigate('/customers/new')}><Plus className="size-4" /> Add Customer</Button> : undefined}
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-y border-hairline">
                  <tr>
                    <Th>Customer</Th>
                    <Th>Package</Th>
                    <Th>RADIUS / ONU</Th>
                    <Th>Area</Th>
                    <Th>Expires</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)} className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-2/50">
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-strong">{c.name}</p>
                            <p className="num text-xs text-muted">{c.customerCode} · {c.phone}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <p className="text-strong">{c.packageSpeed}</p>
                        <p className="text-xs text-muted">
                          <span className="num">{fmtMoney(c.monthlyFee)}</span>
                        </p>
                      </Td>
                      <Td>
                        <p className="num text-strong">{c.radiusId ?? '—'}</p>
                        <p className="num text-xs text-muted">{c.onuSerial ?? '—'}</p>
                      </Td>
                      <Td className="text-muted-strong">{c.area ?? '—'}</Td>
                      <Td><ExpiryText date={c.expireDate} /></Td>
                      <Td><StatusBadge status={c.status} /></Td>
                      <Td align="right"><ChevronRight className="inline size-4 text-muted" /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="border-t border-hairline lg:hidden">
              {data.data.map((c) => (
                <li key={c.id} className="border-b border-hairline last:border-0">
                  <Link to={`/customers/${c.id}`} className="flex items-start gap-3 px-6 py-4">
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium text-strong">{c.name}</p>
                        <StatusBadge status={c.status} />
                      </div>
                      <p className="num mt-0.5 text-xs text-muted">{c.customerCode} · {c.phone}</p>
                      <div className="mt-2 flex items-end justify-between gap-2 text-xs">
                        <span className="text-muted-strong">{c.packageSpeed} · <span className="num">{fmtMoney(c.monthlyFee)}</span></span>
                        <ExpiryText date={c.expireDate} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              total={data.meta.total}
              pageSize={data.meta.pageSize}
              onPage={(p) => update({ page: p })}
            />
          </div>
        )}
      </Card>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
