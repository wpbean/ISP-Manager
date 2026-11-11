import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { ImportResult } from '@isp/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, Modal } from '@/components/ui';

const TEMPLATE_HEADERS =
  'customerCode,name,phone,altPhone,email,nid,address,area,status,packageSpeed,monthlyFee,connectionDate,billingDate,expireDate,radiusId,pppoeUsername,onuSerial,onuModel,ponId,oltName,ponPort,onuId,splitterName,splitterRatio,splitterPort,boxName,cableId,coreNumber,coreColor,tubeColor,rxPower,txPower,cableLength,latitude,longitude,notes';
const TEMPLATE_ROW =
  ',Rahim Uddin,01711000000,,,,"House 12, Road 3, Mirpur",Mirpur,ACTIVE,Home 20,20 Mbps,800,2026-01-15,2026-12-14,2026-12-14,rahim001,HWTC1A2B3C4D,Huawei HG8010H,OLT-MIR-01,0/1/3,12,SPL-MIR-4,1:16,7,TJ-MIR-9,CBL-210,5,Blue,Orange,-19.4,2.1,640,23.8223,90.3654,';

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const close = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  const downloadTemplate = () => {
    const blob = new Blob([`${TEMPLATE_HEADERS}\n${TEMPLATE_ROW}\n`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'customers-template.csv';
    a.click();
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<ImportResult>('/customers/import', fd);
      setResult(data);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Imported: ${data.created} created, ${data.updated} updated`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import customers"
      subtitle="Upload a CSV. Rows with an existing customer code are updated; others are created."
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={upload} disabled={!file} loading={busy}>
              <Upload className="size-4" /> Import
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Created', value: result.created, cls: 'text-up' },
              { label: 'Updated', value: result.updated, cls: 'text-strong' },
              { label: 'Failed', value: result.failed.length, cls: result.failed.length ? 'text-down' : 'text-strong' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-surface-2 p-4">
                <p className="text-xs text-muted">{s.label}</p>
                <p className={`num mt-1 text-2xl font-bold ${s.cls}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {result.failed.length > 0 && (
            <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-lg border border-hairline">
              {result.failed.map((f) => (
                <div key={f.row} className="flex gap-3 border-b border-hairline px-4 py-2 text-[13px] last:border-0">
                  <span className="num shrink-0 text-muted">Row {f.row}</span>
                  <span className="text-down">{f.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-2/50 px-6 py-10 text-center hover:border-primary/60"
          >
            <FileSpreadsheet className="mb-3 size-8 text-accent" />
            <p className="text-sm font-medium text-strong">{file ? file.name : 'Choose a CSV file'}</p>
            <p className="mt-1 text-xs text-muted">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Max 5 MB · 5000 rows'}</p>
          </button>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="text-[13px] text-muted">
            Column headers must match the export format.{' '}
            <button type="button" onClick={downloadTemplate} className="font-medium text-accent">Download template</button>
          </p>
        </div>
      )}
    </Modal>
  );
}
