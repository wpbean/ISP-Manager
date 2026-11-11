import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';
import { BILLING_CYCLE_DAYS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, ROLE_LABELS, type Customer, type PaymentMethod } from '@isp/shared';
import { useCollectors, useCreatePayment } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';

interface Values {
  amount: string;
  months: string;
  method: PaymentMethod;
  transactionId: string;
  paidAt: string;
  note: string;
  collectedById: string;
}

/** Mirrors server/src/services/billing.ts computeRenewal — preview only. */
function previewRenewal(expireDate: string | null, months: number) {
  if (months <= 0) return null;
  const today = todayISO();
  const valid = !!expireDate && expireDate >= today;
  const base = new Date(`${valid ? expireDate : today}T00:00:00Z`);
  const from = new Date(base);
  if (valid) from.setUTCDate(from.getUTCDate() + 1);
  const to = new Date(base);
  to.setUTCDate(to.getUTCDate() + months * BILLING_CYCLE_DAYS);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function PaymentModal({ customer, open, onClose }: { customer: Customer; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreatePayment();
  const { user } = useAuth();
  const { data: collectors } = useCollectors(open);
  const { register, handleSubmit, control, setValue, reset, getFieldState, formState } = useForm<Values>({
    defaultValues: { amount: String(customer.monthlyFee), months: '1', method: 'CASH', transactionId: '', paidAt: todayISO(), note: '', collectedById: user?.id ?? '' },
  });

  useEffect(() => {
    if (open) reset({ amount: String(customer.monthlyFee), months: '1', method: 'CASH', transactionId: '', paidAt: todayISO(), note: '', collectedById: user?.id ?? '' });
  }, [open, customer.monthlyFee, reset, user?.id]);

  const [months, method] = useWatch({ control, name: ['months', 'method'] });
  const m = Number(months);

  // Keep amount = fee × months until the user edits the amount by hand.
  useEffect(() => {
    if (!getFieldState('amount').isDirty) setValue('amount', String(customer.monthlyFee * Math.max(m, 1)));
  }, [m, customer.monthlyFee, setValue, getFieldState]);

  const renewal = useMemo(() => previewRenewal(customer.expireDate, m), [customer.expireDate, m]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync({
        customerId: customer.id,
        amount: Number(v.amount),
        months: m,
        method: v.method,
        transactionId: v.transactionId,
        paidAt: v.paidAt,
        note: v.note,
        collectedById: v.collectedById || undefined,
      });
      toast.success(`Payment ${res.data.receiptNo} recorded`, {
        description: res.data.periodTo ? `Service extended to ${fmtDate(res.data.periodTo)}` : undefined,
        action: { label: 'Receipt', onClick: () => navigate(`/payments/${res.data.id}/receipt`) },
      });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      subtitle={`${customer.name} · ${customer.customerCode} · ${customer.packageSpeed} (${fmtMoney(customer.monthlyFee)}/mo)`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>Confirm payment</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="rounded-lg bg-surface-2 p-4">
          <p className="text-xs text-muted">Amount received</p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold text-muted-strong">৳</span>
            <input
              {...register('amount', { required: true, validate: (x) => Number(x) > 0 })}
              inputMode="decimal"
              className="num w-full bg-transparent text-[40px] leading-tight font-bold tracking-tight text-strong outline-none"
              aria-label="Amount"
            />
          </div>
          {formState.errors.amount && <p className="text-xs text-down">Enter an amount greater than 0</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Renew service for">
            <Select {...register('months')}>
              <option value="0">No renewal (due / partial)</option>
              {[1, 2, 3, 4, 5, 6, 9, 12].map((n) => <option key={n} value={n}>{n} month{n > 1 ? 's' : ''} ({n * BILLING_CYCLE_DAYS} days)</option>)}
            </Select>
          </Field>
          <Field label="Payment method">
            <Select {...register('method')}>
              {PAYMENT_METHODS.map((pm) => <option key={pm} value={pm}>{PAYMENT_METHOD_LABELS[pm]}</option>)}
            </Select>
          </Field>
          {method !== 'CASH' && (
            <Field label="Transaction ID">
              <Input {...register('transactionId')} numeric placeholder="e.g. bKash TrxID" />
            </Field>
          )}
          <Field label="Payment date">
            <Input {...register('paidAt')} type="date" numeric max={todayISO()} />
          </Field>
          <Field label="Collected by">
            <Select {...register('collectedById')}>
              {!collectors && user && <option value={user.id}>{user.name} (you)</option>}
              {collectors?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.id === user?.id ? ' (you)' : ''} · {ROLE_LABELS[s.role]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Note">
          <Textarea {...register('note')} className="min-h-[64px]" placeholder="Optional" />
        </Field>

        {renewal && (
          <div className="flex items-start gap-3 rounded-lg border border-hairline px-4 py-3">
            <CalendarCheck className="mt-0.5 size-5 shrink-0 text-up" />
            <div className="text-[13px]">
              <p className="text-muted-strong">
                Service period <span className="num text-strong">{fmtDate(renewal.from)}</span> → <span className="num text-strong">{fmtDate(renewal.to)}</span>
              </p>
              <p className="mt-0.5 text-muted">
                Expiry changes from <span className="num">{fmtDate(customer.expireDate)}</span> to <span className="num text-up">{fmtDate(renewal.to)}</span>
                {(customer.status === 'SUSPENDED' || customer.status === 'PENDING') && ' · customer will be re-activated'}
              </p>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
