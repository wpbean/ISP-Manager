import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Cable, CreditCard, MapPin, Router, Save, User } from 'lucide-react';
import { toast } from 'sonner';
import {
  BILLING_CYCLE_DAYS,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  FIBER_COLORS,
  NETWORK_FIELDS,
  SPLITTER_RATIOS,
  customerSchema,
  type Customer,
  type CustomerInput,
} from '@isp/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { useAreas, useCustomer, useSaveCustomer } from '@/lib/queries';
import { todayISO } from '@/lib/format';
import { MapPicker } from '@/components/MapPicker';
import { HeaderActions } from '@/components/layout/HeaderActions';
import { Button, Card, CardHeader, Field, Input, PageHeader, PageLoader, Select, Textarea } from '@/components/ui';

type FormValues = Record<keyof CustomerInput, string>;

const ALL_KEYS = Object.keys(customerSchema.shape) as (keyof CustomerInput)[];

/** "YYYY-MM-DD" + n days, or '' for an empty/invalid date. */
function plusDays(date: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toForm(c?: Customer): FormValues {
  const v = {} as FormValues;
  for (const k of ALL_KEYS) {
    const raw = c?.[k as keyof Customer];
    v[k] = raw === null || raw === undefined ? '' : String(raw);
  }
  // The form edits only the number; "Mbps" is a fixed suffix (legacy values like "1 Gbps" stay as-is).
  v.packageSpeed = v.packageSpeed.replace(/^\s*(\d+(?:\.\d+)?)\s*mbps\s*$/i, '$1');
  if (!c) {
    v.status = 'ACTIVE';
    v.connectionDate = todayISO();
    v.billingDate = v.expireDate = plusDays(v.connectionDate, BILLING_CYCLE_DAYS);
  }
  return v;
}

function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} className="border-b border-hairline" />
      <div className="grid gap-x-5 gap-y-4 p-6 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </Card>
  );
}

export function CustomerFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: customer, isLoading } = useCustomer(id);
  const { data: areas } = useAreas();
  const save = useSaveCustomer(id);

  // Technicians (customers:update_network) can only edit network/fiber/location fields.
  const networkOnly = isEdit && !can('customers:update') && can('customers:update_network');
  const isNetwork = (k: string) => (NETWORK_FIELDS as readonly string[]).includes(k);

  const form = useForm<FormValues>({
    resolver: zodResolver(customerSchema) as never,
    defaultValues: toForm(),
  });
  const { register, handleSubmit, reset, setValue, control, formState } = form;
  const errors = formState.errors as Partial<Record<keyof CustomerInput, { message?: string }>>;

  useEffect(() => {
    if (customer) reset(toForm(customer));
  }, [customer, reset]);

  const [lat, lng, connectionDate] = useWatch({ control, name: ['latitude', 'longitude', 'connectionDate'] });

  // New customers: expire date follows join date + 30 days until edited by hand.
  useEffect(() => {
    if (isEdit || !connectionDate) return;
    const due = plusDays(connectionDate, BILLING_CYCLE_DAYS);
    if (!due) return;
    if (!form.getFieldState('expireDate').isDirty) setValue('expireDate', due);
  }, [isEdit, connectionDate, form, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    const speed = values.packageSpeed.trim();
    let body = {
      ...values,
      packageSpeed: /^\d+(\.\d+)?$/.test(speed) ? `${speed} Mbps` : speed,
      // Billing (next bill due) and expiry are one date in the UI; keep the stored columns in sync.
      billingDate: values.expireDate,
    } as unknown as Partial<CustomerInput>;
    if (networkOnly) {
      body = Object.fromEntries(Object.entries(body).filter(([k]) => isNetwork(k)));
    }
    try {
      const saved = await save.mutateAsync(body);
      toast.success(isEdit ? 'Customer updated' : `Customer ${saved.customerCode} created`);
      navigate(`/customers/${saved.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  // Locked fields use readOnly (not disabled) so RHF still submits their values for validation.
  const reg = (k: keyof CustomerInput) => {
    const locked = networkOnly && !isNetwork(k);
    return { ...register(k), id: k, readOnly: locked, className: locked ? 'cursor-not-allowed opacity-60' : undefined };
  };
  const err = (k: keyof CustomerInput) => errors[k]?.message;

  const areaList = useMemo(() => areas ?? [], [areas]);

  if (isEdit && isLoading) return <PageLoader />;

  return (
    <form id="customer-form" onSubmit={onSubmit} noValidate>
      {/* Sticky top-bar actions (portal, so the submit button targets the form by id). */}
      <HeaderActions>
        <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        <Button size="sm" type="submit" form="customer-form" loading={formState.isSubmitting}>
          <Save className="size-4" /> {isEdit ? 'Save changes' : 'Create customer'}
        </Button>
      </HeaderActions>
      <PageHeader
        back={
          <Link to={isEdit ? `/customers/${id}` : '/customers'} className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-strong">
            <ArrowLeft className="size-4" /> Back
          </Link>
        }
        title={isEdit ? `Edit ${customer?.name ?? 'customer'}` : 'New customer'}
        subtitle={networkOnly ? 'Technician access: you can update network, fiber and location details.' : isEdit ? customer?.customerCode : 'A customer code is generated automatically.'}
      />

      <div className="space-y-6">
        <Section title="Basic information" subtitle="Contact & identity" icon={<User className="size-[18px]" />}>
          <Field label="Full name" required error={err('name')} htmlFor="name">
            <Input {...reg('name')} invalid={!!err('name')} placeholder="e.g. Rahim Uddin" />
          </Field>
          <Field label="Phone" required error={err('phone')} htmlFor="phone">
            <Input {...reg('phone')} numeric inputMode="tel" invalid={!!err('phone')} placeholder="01XXXXXXXXX" />
          </Field>
          <Field label="Alternate phone" error={err('altPhone')} htmlFor="altPhone">
            <Input {...reg('altPhone')} numeric inputMode="tel" />
          </Field>
          <Field label="Email" error={err('email')} htmlFor="email">
            <Input {...reg('email')} type="email" placeholder="optional" />
          </Field>
          <Field label="NID / ID number" error={err('nid')} htmlFor="nid">
            <Input {...reg('nid')} numeric />
          </Field>
          <Field label="Status" error={err('status')} htmlFor="status">
            <Select {...reg('status')} disabled={networkOnly}>
              {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{CUSTOMER_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="Address" required error={err('address')} className="sm:col-span-2" htmlFor="address">
            <Input {...reg('address')} invalid={!!err('address')} placeholder="House, road, area, city" />
          </Field>
          <Field label="Area / zone" error={err('area')} htmlFor="area">
            <Input {...reg('area')} list="areas" placeholder="e.g. Mirpur" />
            <datalist id="areas">{areaList.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Join date" error={err('connectionDate')} htmlFor="connectionDate">
            <Input {...reg('connectionDate')} type="date" numeric />
          </Field>
        </Section>

        <Section title="Service & billing" subtitle="Package, fee and billing cycle" icon={<CreditCard className="size-[18px]" />}>
          <Field label="Package speed" required error={err('packageSpeed')} htmlFor="packageSpeed">
            <Input {...reg('packageSpeed')} numeric inputMode="decimal" trailing="Mbps" invalid={!!err('packageSpeed')} placeholder="e.g. 20" />
          </Field>
          <Field label="Monthly fee" required error={err('monthlyFee')} htmlFor="monthlyFee">
            <Input {...reg('monthlyFee')} numeric inputMode="decimal" leading={<span className="text-sm">৳</span>} invalid={!!err('monthlyFee')} />
          </Field>
          <Field label="Expire date" error={err('expireDate')} hint="Service valid until & next bill due (+30 days per paid month)" htmlFor="expireDate">
            <Input {...reg('expireDate')} type="date" numeric />
          </Field>
        </Section>

        <Section title="RADIUS & ONU" subtitle="Authentication and customer premises equipment" icon={<Router className="size-[18px]" />}>
          <Field label="RADIUS customer ID" error={err('radiusId')} htmlFor="radiusId">
            <Input {...reg('radiusId')} numeric inputMode="numeric" placeholder="e.g. 24545" invalid={!!err('radiusId')} />
          </Field>
          <Field label="PPPoE username" error={err('pppoeUsername')} htmlFor="pppoeUsername">
            <Input {...reg('pppoeUsername')} numeric autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. rahim024" />
          </Field>
          <Field label="ONU serial number" error={err('onuSerial')} htmlFor="onuSerial">
            <Input {...reg('onuSerial')} numeric className="uppercase" placeholder="e.g. HWTC1A2B3C4D" />
          </Field>
          <Field label="ONU model" error={err('onuModel')} htmlFor="onuModel">
            <Input {...reg('onuModel')} placeholder="e.g. Huawei HG8010H" />
          </Field>
          <Field label="PON ID" error={err('ponId')} htmlFor="ponId">
            <Input {...reg('ponId')} numeric inputMode="numeric" placeholder="e.g. 3" invalid={!!err('ponId')} />
          </Field>
          <Field label="ONU ID" error={err('onuId')} hint="ONU number on the PON" htmlFor="onuId">
            <Input {...reg('onuId')} numeric inputMode="numeric" placeholder="e.g. 12" invalid={!!err('onuId')} />
          </Field>
        </Section>

        <Section title="Optical fiber core details" subtitle="OLT → PON → splitter → box → cable core, plus signal levels" icon={<Cable className="size-[18px]" />}>
          <Field label="OLT name / IP" error={err('oltName')} htmlFor="oltName">
            <Input {...reg('oltName')} numeric placeholder="e.g. OLT-MIR-01" />
          </Field>
          <Field label="PON port" error={err('ponPort')} htmlFor="ponPort">
            <Input {...reg('ponPort')} numeric placeholder="e.g. 0/1/3" />
          </Field>
          <Field label="Splitter name" error={err('splitterName')} htmlFor="splitterName">
            <Input {...reg('splitterName')} placeholder="e.g. SPL-MIR-4" />
          </Field>
          <Field label="Splitter ratio" error={err('splitterRatio')} htmlFor="splitterRatio">
            <Select {...reg('splitterRatio')}>
              <option value="">—</option>
              {SPLITTER_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Splitter port" error={err('splitterPort')} htmlFor="splitterPort">
            <Input {...reg('splitterPort')} numeric inputMode="numeric" />
          </Field>
          <Field label="Distribution / TJ box" error={err('boxName')} htmlFor="boxName">
            <Input {...reg('boxName')} placeholder="e.g. TJ-MIR-9" />
          </Field>
          <Field label="Cable ID / route" error={err('cableId')} htmlFor="cableId">
            <Input {...reg('cableId')} numeric />
          </Field>
          <Field label="Core number" error={err('coreNumber')} htmlFor="coreNumber">
            <Input {...reg('coreNumber')} numeric inputMode="numeric" />
          </Field>
          <Field label="Core color" error={err('coreColor')} htmlFor="coreColor">
            <Select {...reg('coreColor')}>
              <option value="">—</option>
              {FIBER_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Tube color" error={err('tubeColor')} htmlFor="tubeColor">
            <Select {...reg('tubeColor')}>
              <option value="">—</option>
              {FIBER_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Cable length" error={err('cableLength')} htmlFor="cableLength">
            <Input {...reg('cableLength')} numeric inputMode="numeric" trailing="m" />
          </Field>
          <Field label="ONU RX power" error={err('rxPower')} hint="Typical good range −8 to −25 dBm" htmlFor="rxPower">
            <Input {...reg('rxPower')} numeric inputMode="decimal" trailing="dBm" placeholder="-19.50" />
          </Field>
          <Field label="ONU TX power" error={err('txPower')} htmlFor="txPower">
            <Input {...reg('txPower')} numeric inputMode="decimal" trailing="dBm" placeholder="2.10" />
          </Field>
        </Section>

        <Card>
          <CardHeader title="Location" subtitle="GPS coordinates of the customer premises" icon={<MapPin className="size-[18px]" />} className="border-b border-hairline" />
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-4">
              <Field label="Latitude" error={err('latitude')} htmlFor="latitude">
                <Input {...reg('latitude')} numeric inputMode="decimal" placeholder="23.810300" />
              </Field>
              <Field label="Longitude" error={err('longitude')} htmlFor="longitude">
                <Input {...reg('longitude')} numeric inputMode="decimal" placeholder="90.412500" />
              </Field>
              <Field label="Notes" error={err('notes')} htmlFor="notes">
                <Textarea {...reg('notes')} placeholder="Landmark, installation notes…" />
              </Field>
            </div>
            <MapPicker
              lat={lat ? Number(lat) : null}
              lng={lng ? Number(lng) : null}
              onChange={(a, b) => {
                setValue('latitude', String(a), { shouldDirty: true });
                setValue('longitude', String(b), { shouldDirty: true });
              }}
            />
          </div>
        </Card>

        <div className="flex justify-end gap-3 pb-4">
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={formState.isSubmitting}>
            <Save className="size-4" /> {isEdit ? 'Save changes' : 'Create customer'}
          </Button>
        </div>
      </div>
    </form>
  );
}
