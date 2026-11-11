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

/** Network changes can rewrite customers' fiber fields (server-side resync). */
function useInvalidateNetwork() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['network'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer'] });
  };
}

export function useCreateNode() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async (body: FiberNodeInput) => (await api.post<{ data: FiberNode }>('/network/nodes', body)).data.data,
    onSuccess: invalidate,
  });
}

export function useUpdateNode() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async ({ id, ...body }: FiberNodeUpdateInput & { id: string }) =>
      (await api.patch<{ data: FiberNode }>(`/network/nodes/${id}`, body)).data.data,
    onSuccess: invalidate,
  });
}

export function useDeleteNode() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/network/nodes/${id}`),
    onSuccess: invalidate,
  });
}

/** Saves canvas positions; patches the cache first so dragged nodes don't jump back. */
export function useSavePositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (positions: { id: string; x: number; y: number }[]) =>
      api.patch('/network/positions', { positions }),
    onMutate: (positions) => {
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
    },
  });
}

export function useCreateLink() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async (body: FiberLinkInput) => (await api.post<{ data: FiberLink }>('/network/links', body)).data.data,
    onSuccess: invalidate,
  });
}

export function useUpdateLink() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async ({ id, ...body }: FiberLinkUpdateInput & { id: string }) =>
      (await api.patch<{ data: FiberLink }>(`/network/links/${id}`, body)).data.data,
    onSuccess: invalidate,
  });
}

export function useDeleteLink() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/network/links/${id}`),
    onSuccess: invalidate,
  });
}

export function useAssignPort() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async (body: FiberAssignInput) => api.post('/network/assignments', body),
    onSuccess: invalidate,
  });
}

export function useUnassignPort() {
  const invalidate = useInvalidateNetwork();
  return useMutation({
    mutationFn: async (customerId: string) => api.delete(`/network/assignments/${customerId}`),
    onSuccess: invalidate,
  });
}
