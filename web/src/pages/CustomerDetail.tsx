import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, CircleMarker } from 'react-leaflet';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  Ban,
  Cable,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  MapPin,
  Network,
  Pencil,
  Phone,
  PlugZap,
  Printer,
  Receipt,
  Router,
  Trash2,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_METHOD_LABELS, type Customer, type CustomerStatus } from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { useCustomer, useCustomerPayments, useDeleteCustomer, useDeletePayment, useSetCustomerStatus } from '@/lib/queries';
import { daysUntil, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { onuOpticalUrl } from '@/lib/olt';
import { radiusClientUrl } from '@/lib/radius';
import { PaymentModal } from '@/components/PaymentModal';
import { MapTiles } from '@/components/MapTiles';
import { fiberHex } from '@/lib/fiber';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataItem,
  EmptyState,
  IconButton,
  PageLoader,
  StatusBadge,
  Td,
  Th,
} from '@/components/ui';

function ColorChip({ color }: { color: string | null }) {
  if (!color) return <>—</>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-3 rounded-full ring-1 ring-hairline" style={{ background: fiberHex(color) ?? 'transparent' }} />
      {color}
    </span>
  );
}

/** Optical RX signal quality. Typical GPON budget: −8 … −25 dBm good, −25 … −27 weak, beyond = poor. */
function SignalQuality({ rx }: { rx: number | null }) {
  if (rx == null) return <span className="text-muted">—</span>;
  const q = rx > -8 ? { label: 'Too strong', tone: 'warn' as const } : rx >= -25 ? { label: 'Good', tone: 'up' as const } : rx >= -27 ? { label: 'Weak', tone: 'warn' as const } : { label: 'Poor', tone: 'down' as const };
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num">{rx.toFixed(2)} dBm</span>
      <Badge tone={q.tone}>{q.label}</Badge>
    </span>
  );
}

function FiberPath({ c }: { c: Customer }) {
  const nodes = [
    { label: 'OLT', value: c.oltName },
    { label: 'PON', value: c.ponPort ? `${c.ponPort}${c.onuId != null ? ` · #${c.onuId}` : ''}` : null },
    { label: 'Splitter', value: c.splitterName ? `${c.splitterName}${c.splitterRatio ? ` (${c.splitterRatio})` : ''}${c.splitterPort != null ? ` · P${c.splitterPort}` : ''}` : null },
    { label: 'Box', value: c.boxName },
    { label: 'ONU', value: c.onuSerial },
  ];
  return (
    <div className="flex flex-wrap items-center gap-y-3">
      {nodes.map((n, i) => (
        <div key={n.label} className="flex items-center">
          <div className="min-w-[124px] rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{n.label}</p>
            <p className={clsx('num mt-0.5 text-[13px] whitespace-nowrap', n.value ? 'text-strong' : 'text-muted')}>{n.value ?? '—'}</p>
          </div>
          {i < nodes.length - 1 && <div className="h-[2px] w-6 shrink-0 bg-primary/60" />}
        </div>
      ))}
    </div>
  );
}

function Section({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} action={action} />
      <div className="px-6 pb-6">{children}</div>
    </Card>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: c, isLoading, error } = useCustomer(id);
  const { data: payments } = useCustomerPayments(id, can('payments:read'));
  const setStatus = useSetCustomerStatus();
  const del = useDeleteCustomer();
  const delPayment = useDeletePayment();
  const [payOpen, setPayOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'delete' } | { kind: 'status'; status: CustomerStatus } | { kind: 'payment'; id: string; receiptNo: string }>(null);

  if (isLoading) return <PageLoader />;
  if (error || !c) return <EmptyState title="Customer not found" action={<Button onClick={() => navigate('/customers')}>Back to customers</Button>} />;

  const days = daysUntil(c.expireDate);
  const canEdit = can('customers:update') || can('customers:update_network');
  const lastPayment = payments?.[0];
  const opticalUrl = onuOpticalUrl(c.ponId, c.onuId);
  const radiusUrl = radiusClientUrl(c.radiusId);

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Copied'));

  const runConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'delete') {
        await del.mutateAsync(c.id);
        toast.success('Customer deleted');
        navigate('/customers');
      } else if (confirm.kind === 'status') {
        await setStatus.mutateAsync({ id: c.id, status: confirm.status });
        toast.success(`Status changed to ${confirm.status.toLowerCase()}`);
      } else {
        await delPayment.mutateAsync(confirm.id);
        toast.success(`Payment ${confirm.receiptNo} deleted`);
      }
      setConfirm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/customers" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-strong">
        <ArrowLeft className="size-4" /> Customers
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={c.name} className="size-14 text-base" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-strong md:text-[28px]">{c.name}</h1>
              <StatusBadge status={c.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <button onClick={() => copy(c.customerCode)} className="num inline-flex items-center gap-1 hover:text-strong">
                {c.customerCode} <Copy className="size-3" />
              </button>
              <a href={`tel:${c.phone}`} className="num inline-flex items-center gap-1 hover:text-strong">
                <Phone className="size-3.5" /> {c.phone}
              </a>
              {c.area && <span>{c.area}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('payments:create') && (
            <Button onClick={() => setPayOpen(true)}>
              <CreditCard className="size-4" /> Record Payment
            </Button>
          )}
          {canEdit && (
            <Button variant="secondary" onClick={() => navigate(`/customers/${c.id}/edit`)}>
              <Pencil className="size-4" /> Edit
            </Button>
          )}
          {can('customers:update') && (c.status === 'ACTIVE' ? (
            <Button variant="secondary" onClick={() => setConfirm({ kind: 'status', status: 'SUSPENDED' })}>
              <Ban className="size-4" /> Suspend
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirm({ kind: 'status', status: 'ACTIVE' })}>
              <CheckCircle2 className="size-4" /> Activate
            </Button>
          ))}
          {can('customers:update') && c.status !== 'DISCONNECTED' && (
            <Button variant="ghost" onClick={() => setConfirm({ kind: 'status', status: 'DISCONNECTED' })}>
              <PlugZap className="size-4" /> Disconnect
            </Button>
          )}
          {can('customers:delete') && (
            <IconButton label="Delete customer" className="hover:text-down" onClick={() => setConfirm({ kind: 'delete' })}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Key figures */}
      <Card className="grid grid-cols-2 divide-hairline md:grid-cols-4 md:divide-x">
        {[
          { label: 'Monthly fee', value: <span className="text-accent">{fmtMoney(c.monthlyFee)}</span>, sub: c.packageSpeed },
          {
            label: 'Expires',
            value: fmtDate(c.expireDate),
            sub: days == null ? 'Not set' : (
              <span className={days < 0 ? 'text-down' : days <= 7 ? 'text-warn' : 'text-up'}>
                {days < 0 ? `▼ Expired ${-days} days ago` : days === 0 ? '▲ Expires today' : `▲ ${days} days left`}
              </span>
            ),
          },
          { label: 'Join date', value: fmtDate(c.connectionDate), sub: c.connectionDate ? 'Customer since' : 'Not set' },
          { label: 'Last payment', value: lastPayment ? fmtMoney(lastPayment.amount) : '—', sub: lastPayment ? fmtDateTime(lastPayment.paidAt) : can('payments:read') ? 'No payments yet' : '—' },
        ].map((s) => (
          <div key={s.label} className="p-5">
            <p className="text-xs font-medium text-muted">{s.label}</p>
            <p className="num mt-1.5 text-xl font-bold text-strong">{s.value}</p>
            <p className="num mt-1 truncate text-xs text-muted">{s.sub}</p>
          </div>
        ))}
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section
            title="Optical fiber path"
            icon={<Cable className="size-[18px]" />}
            action={
              can('network:read') ? (
                <Link to={c.fiberNodeId ? `/network?customer=${c.id}` : '/network'}>
                  <Button size="sm" variant="secondary">
                    <Network className="size-4" /> {c.fiberNodeId ? 'View in network map' : 'Network map'}
                  </Button>
                </Link>
              ) : undefined
            }
          >
            <FiberPath c={c} />
            <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              <DataItem label="OLT" value={c.oltName} mono />
              <DataItem label="PON port" value={c.ponPort} mono />
              <DataItem label="Splitter" value={c.splitterName} mono />
              <DataItem label="Splitter ratio / port" value={c.splitterRatio || c.splitterPort != null ? `${c.splitterRatio ?? '—'} / ${c.splitterPort ?? '—'}` : null} mono />
              <DataItem label="TJ / distribution box" value={c.boxName} mono />
              <DataItem label="Cable ID" value={c.cableId} mono />
              <DataItem label="Core number" value={c.coreNumber} mono />
              <DataItem label="Core color" value={<ColorChip color={c.coreColor} />} />
              <DataItem label="Tube color" value={<ColorChip color={c.tubeColor} />} />
              <DataItem label="Cable length" value={c.cableLength != null ? `${c.cableLength.toLocaleString()} m` : null} mono />
              <DataItem label="TX power" value={c.txPower != null ? `${c.txPower.toFixed(2)} dBm` : null} mono />
              <DataItem label="RX power" value={<SignalQuality rx={c.rxPower} />} className="sm:col-span-2" />
            </dl>
          </Section>

          {can('payments:read') && (
            <Card>
              <CardHeader title="Payment history" icon={<Receipt className="size-[18px]" />} subtitle={payments ? `${payments.length} payments · ${fmtMoney(payments.reduce((s, p) => s + p.amount, 0))} total` : undefined} />
              {!payments?.length ? (
                <EmptyState title="No payments yet" message="Recorded payments will appear here." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y border-hairline">
                      <tr><Th>Receipt</Th><Th>Date</Th><Th>Method</Th><Th>Period</Th><Th align="right">Amount</Th><Th /></tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-b border-hairline last:border-0">
                          <Td className="num whitespace-nowrap text-strong">{p.receiptNo}</Td>
                          <Td className="num whitespace-nowrap text-muted-strong">{fmtDateTime(p.paidAt)}</Td>
                          <Td>
                            <span className="text-muted-strong">{PAYMENT_METHOD_LABELS[p.method]}</span>
                            {p.transactionId && <p className="num text-xs text-muted">{p.transactionId}</p>}
                          </Td>
                          <Td className="num text-xs whitespace-nowrap text-muted">
                            {p.periodFrom ? `${fmtDate(p.periodFrom)} → ${fmtDate(p.periodTo)}` : 'No renewal'}
                          </Td>
                          <Td align="right" className="num font-semibold text-up">+{fmtMoney(p.amount)}</Td>
                          <Td align="right">
                            <div className="flex justify-end gap-1">
                              <IconButton label="Print receipt" onClick={() => navigate(`/payments/${p.id}/receipt`)}><Printer className="size-4" /></IconButton>
                              {can('payments:delete') && (
                                <IconButton label="Delete payment" className="hover:text-down" onClick={() => setConfirm({ kind: 'payment', id: p.id, receiptNo: p.receiptNo })}>
                                  <Trash2 className="size-4" />
                                </IconButton>
                              )}
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Section title="Contact" icon={<User className="size-[18px]" />}>
            <dl className="grid gap-5">
              <DataItem label="Address" value={c.address} />
              <div className="grid grid-cols-2 gap-5">
                <DataItem label="Phone" value={c.phone} mono />
                <DataItem label="Alt. phone" value={c.altPhone} mono />
                <DataItem label="Email" value={c.email} />
                <DataItem label="NID" value={c.nid} mono />
              </div>
              {c.notes && <DataItem label="Notes" value={<span className="whitespace-pre-wrap">{c.notes}</span>} />}
            </dl>
          </Section>

          <Section
            title="RADIUS & ONU"
            icon={<Router className="size-[18px]" />}
            action={opticalUrl ? (
              <a href={opticalUrl} target="_blank" rel="noopener noreferrer" title="Open ONU optical info in the OLT panel" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                Optical info <ExternalLink className="size-3.5" />
              </a>
            ) : undefined}
          >
            <dl className="grid gap-5">
              <DataItem label="RADIUS customer ID" value={c.radiusId != null && (
                <span className="inline-flex items-center gap-2.5">
                  {radiusUrl ? (
                    <a href={radiusUrl} target="_blank" rel="noopener noreferrer" title="Open client in RADIUS panel" className="num inline-flex items-center gap-1.5 text-accent hover:underline">
                      {c.radiusId} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="num">{c.radiusId}</span>
                  )}
                  <button onClick={() => copy(String(c.radiusId))} title="Copy RADIUS ID" aria-label="Copy RADIUS ID" className="text-muted hover:text-accent">
                    <Copy className="size-3" />
                  </button>
                </span>
              )} />
              <DataItem label="PPPoE username" value={c.pppoeUsername && (
                <button onClick={() => copy(c.pppoeUsername!)} className="num inline-flex items-center gap-1.5 hover:text-accent">{c.pppoeUsername} <Copy className="size-3" /></button>
              )} />
              <DataItem label="ONU serial number" value={c.onuSerial && (
                <button onClick={() => copy(c.onuSerial!)} className="num inline-flex items-center gap-1.5 hover:text-accent">{c.onuSerial} <Copy className="size-3" /></button>
              )} />
              <DataItem label="ONU model" value={c.onuModel} />
              <div className="grid grid-cols-2 gap-5">
                <DataItem label="PON ID" value={c.ponId} mono />
                <DataItem label="ONU ID" value={c.onuId} mono />
              </div>
            </dl>
          </Section>

          <Section
            title="Location"
            icon={<MapPin className="size-[18px]" />}
            action={c.latitude != null && c.longitude != null ? (
              <a href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                Navigate <ExternalLink className="size-3.5" />
              </a>
            ) : undefined}
          >
            {c.latitude != null && c.longitude != null ? (
              <>
                <div className="h-56 overflow-hidden rounded-lg">
                  <MapContainer center={[c.latitude, c.longitude]} zoom={16} className="h-full w-full" scrollWheelZoom={false}>
                    <MapTiles />
                    <CircleMarker center={[c.latitude, c.longitude]} radius={9} pathOptions={{ color: '#181a20', weight: 2, fillColor: '#FCD535', fillOpacity: 1 }} />
                  </MapContainer>
                </div>
                <p className="num mt-3 text-xs text-muted">{c.latitude.toFixed(6)}, {c.longitude.toFixed(6)}</p>
              </>
            ) : (
              <p className="text-sm text-muted">No GPS coordinates saved.</p>
            )}
          </Section>
        </div>
      </div>

      {can('payments:create') && <PaymentModal customer={c} open={payOpen} onClose={() => setPayOpen(false)} />}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={del.isPending || setStatus.isPending || delPayment.isPending}
        danger={confirm?.kind === 'delete' || confirm?.kind === 'payment' || (confirm?.kind === 'status' && confirm.status !== 'ACTIVE')}
        title={
          confirm?.kind === 'delete' ? 'Delete customer?' : confirm?.kind === 'payment' ? 'Delete payment?' : `Change status`
        }
        confirmLabel={confirm?.kind === 'status' ? 'Confirm' : 'Delete'}
        message={
          confirm?.kind === 'delete'
            ? `This permanently deletes ${c.name} and all ${payments?.length ?? 0} payment records. This cannot be undone.`
            : confirm?.kind === 'payment'
              ? `Delete payment ${confirm.receiptNo}? If it is the latest renewal, the customer's expiry date will be rolled back.`
              : confirm?.kind === 'status'
                ? `Set ${c.name} to ${confirm.status.toLowerCase()}?`
                : ''
        }
      />
    </div>
  );
}
