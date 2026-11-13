import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Customer,
  Collector,
  CustomerInput,
  CustomerListQuery,
  CustomerStatus,
  DashboardStats,
  FiberAssignInput,
  FiberLink,
  FiberInsertBoxInput,
  FiberLinkInput,
  FiberLinkUpdateInput,
  FiberNetwork,
  FiberNode,
  FiberNodeInput,
  FiberNodeUpdateInput,
  Paginated,
  Payment,
  PaymentCreateInput,
  PaymentListQuery,
  User,
  UserCreateInput,
  UserUpdateInput,
} from '@isp/shared';
import { api } from './api';
import { record as recordNetworkChange, tracked } from './networkHistory';

const clean = (o: object) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null));

// ---- Dashboard -------------------------------------------------------------
export const useDashboard = () =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<{ data: DashboardStats }>('/dashboard/stats')).data.data,
  });

// ---- Customers -------------------------------------------------------------
export const useCustomers = (params: Partial<CustomerListQuery>) =>
  useQuery({
    queryKey: ['customers', params],
    queryFn: async () => (await api.get<Paginated<Customer>>('/customers', { params: clean(params) })).data,
    placeholderData: keepPreviousData,
  });

export const useCustomer = (id: string | undefined) =>
  useQuery({
    queryKey: ['customer', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ data: Customer }>(`/customers/${id}`)).data.data,
  });

export const useCustomerPayments = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['customer', id, 'payments'],
    enabled: !!id && enabled,
    queryFn: async () => (await api.get<{ data: Payment[] }>(`/customers/${id}/payments`)).data.data,
  });

export const useAreas = () =>
  useQuery({
    queryKey: ['customers', 'areas'],
    queryFn: async () => (await api.get<{ data: string[] }>('/customers/areas')).data.data,
    staleTime: 5 * 60_000,
  });

function useInvalidateCustomers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useSaveCustomer(id?: string) {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (body: Partial<CustomerInput>) =>
      id
        ? (await api.patch<{ data: Customer }>(`/customers/${id}`, body)).data.data
        : (await api.post<{ data: Customer }>('/customers', body)).data.data,
    onSuccess: invalidate,
  });
}

export function useSetCustomerStatus() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CustomerStatus }) =>
      (await api.patch<{ data: Customer }>(`/customers/${id}/status`, { status })).data.data,
    onSuccess: invalidate,
  });
}

export function useDeleteCustomer() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/customers/${id}`),
    onSuccess: invalidate,
  });
}

// ---- Payments --------------------------------------------------------------
export const usePayments = (params: Partial<PaymentListQuery>) =>
  useQuery({
    queryKey: ['payments', params],
    queryFn: async () =>
      (await api.get<Paginated<Payment> & { meta: { totalAmount: number } }>('/payments', { params: clean(params) }))
        .data,
    placeholderData: keepPreviousData,
  });

export const usePayment = (id: string | undefined) =>
  useQuery({
    queryKey: ['payment', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ data: Payment }>(`/payments/${id}`)).data.data,
  });

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PaymentCreateInput) =>
      (await api.post<{ data: Payment; customer: Customer }>('/payments', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export const useCollectors = (enabled = true) =>
  useQuery({
    queryKey: ['payments', 'collectors'],
    enabled,
    queryFn: async () => (await api.get<{ data: Collector[] }>('/payments/collectors')).data.data,
    staleTime: 5 * 60_000,
  });

// ---- Users -----------------------------------------------------------------
export const useUsers = () =>
  useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ data: User[] }>('/users')).data.data,
  });

export function useSaveUser(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UserCreateInput | UserUpdateInput) =>
      id ? (await api.patch(`/users/${id}`, body)).data : (await api.post('/users', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

// ---- Fiber network (builder) -------------------------------------------------
export const useNetwork = (enabled = true) =>
  useQuery({
    queryKey: ['network'],
    enabled,
    queryFn: async () => (await api.get<{ data: FiberNetwork }>('/network')).data.data,
  });

/** Network changes can rewrite customers' fiber fields (server-side resync); every change is recorded for undo. */
function useTracked() {
  const qc = useQueryClient();
  const net = () => qc.getQueryData<FiberNetwork>(['network']);
  return {
    track: <T,>(label: string, run: () => Promise<T>) => tracked(qc, label, run),
    nodeName: (id: string) => net()?.nodes.find((n) => n.id === id)?.name ?? 'device',
    link: (id: string) => net()?.links.find((l) => l.id === id),
    customerName: (id: string) => net()?.customers.find((c) => c.id === id)?.name ?? 'customer',
  };
}

export function useCreateNode() {
  const t = useTracked();
  return useMutation({
    mutationFn: (body: FiberNodeInput) =>
      t.track(`Add ${body.name}`, async () => (await api.post<{ data: FiberNode }>('/network/nodes', body)).data.data),
  });
}

export function useUpdateNode() {
  const t = useTracked();
  return useMutation({
    mutationFn: ({ id, ...body }: FiberNodeUpdateInput & { id: string }) =>
      t.track(
        body.latitude !== undefined && Object.keys(body).length <= 2 ? `Move ${t.nodeName(id)}` : `Edit ${t.nodeName(id)}`,
        async () => (await api.patch<{ data: FiberNode }>(`/network/nodes/${id}`, body)).data.data,
      ),
  });
}

export function useDeleteNode() {
  const t = useTracked();
  return useMutation({
    mutationFn: (id: string) => t.track(`Delete ${t.nodeName(id)}`, () => api.delete(`/network/nodes/${id}`)),
  });
}

/** Saves canvas positions; patches the cache first so dragged nodes don't jump back. */
export function useSavePositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (positions: { id: string; x: number; y: number }[]) =>
      api.patch('/network/positions', { positions }),
    onMutate: (positions) => {
      const before = qc.getQueryData<FiberNetwork>(['network']);
      const byId = new Map(positions.map((p) => [p.id, p]));
      qc.setQueryData<FiberNetwork>(['network'], (old) =>
        old && {
          ...old,
          nodes: old.nodes.map((n) => {
            const p = byId.get(n.id);
            return p ? { ...n, posX: p.x, posY: p.y } : n;
          }),
        },
      );
      return { before, after: qc.getQueryData<FiberNetwork>(['network']) };
    },
    onSuccess: (_r, positions, ctx) => {
      if (!ctx?.before || !ctx.after) return;
      const name = positions.length === 1 ? ctx.before.nodes.find((n) => n.id === positions[0]!.id)?.name : undefined;
      recordNetworkChange(name ? `Move ${name}` : `Move ${positions.length} devices`, ctx.before, ctx.after);
    },
    onError: (_e, _p, ctx) => ctx?.before && qc.setQueryData(['network'], ctx.before),
  });
}

export function useCreateLink() {
  const t = useTracked();
  return useMutation({
    mutationFn: (body: FiberLinkInput) =>
      t.track(`Add cable${body.cableCode ? ` ${body.cableCode}` : ''}`, async () => (await api.post<{ data: FiberLink }>('/network/links', body)).data.data),
  });
}

export function useUpdateLink() {
  const t = useTracked();
  return useMutation({
    mutationFn: ({ id, ...body }: FiberLinkUpdateInput & { id: string }) =>
      t.track(
        `${Object.keys(body).every((k) => k === 'path' || k === 'length') && 'path' in body ? 'Route' : 'Edit'} cable${t.link(id)?.cableCode ? ` ${t.link(id)!.cableCode}` : ''}`,
        async () => (await api.patch<{ data: FiberLink }>(`/network/links/${id}`, body)).data.data,
      ),
  });
}

export function useInsertBox() {
  const t = useTracked();
  return useMutation({
    mutationFn: ({ linkId, ...body }: FiberInsertBoxInput & { linkId: string }) =>
      t.track(
        `Insert ${body.newBox?.name ?? (body.boxId ? t.nodeName(String(body.boxId)) : 'TJ box')}`,
        async () =>
          (await api.post<{ data: { box: FiberNode; links: FiberLink[] } }>(`/network/links/${linkId}/insert-box`, body)).data.data,
      ),
  });
}

export function useDeleteLink() {
  const t = useTracked();
  return useMutation({
    mutationFn: (id: string) =>
      t.track(`Delete cable${t.link(id)?.cableCode ? ` ${t.link(id)!.cableCode}` : ''}`, () => api.delete(`/network/links/${id}`)),
  });
}

export function useAssignPort() {
  const t = useTracked();
  return useMutation({
    mutationFn: (body: FiberAssignInput) =>
      t.track(`Patch customer to ${t.nodeName(body.nodeId)} port ${body.port}`, () => api.post('/network/assignments', body)),
  });
}

export function useUnassignPort() {
  const t = useTracked();
  return useMutation({
    mutationFn: (customerId: string) =>
      t.track(`Unpatch ${t.customerName(customerId)}`, () => api.delete(`/network/assignments/${customerId}`)),
  });
}
