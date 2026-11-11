import type { Customer } from '@prisma/client';
import { BILLING_CYCLE_DAYS } from '@isp/shared';
import { addDays, todayDate } from '../lib/dates';

/**
 * Renewal rule (one month = BILLING_CYCLE_DAYS = 30 days):
 *  - If the customer is still valid (expireDate >= today), the new expiry is the current
 *    expiry + 30 × months (no lost days); the period starts the day after the current expiry.
 *  - If already expired (or no expiry set), the new expiry is today + 30 × months; the period
 *    starts today.
 *  - periodTo = new expireDate; billingDate (next bill due) = new expireDate.
 */
export function computeRenewal(customer: Pick<Customer, 'expireDate'>, months: number) {
  const today = todayDate();
  const valid = !!customer.expireDate && customer.expireDate >= today;
  const base = valid ? customer.expireDate! : today;
  const periodFrom = valid ? addDays(base, 1) : today;
  const periodTo = addDays(base, months * BILLING_CYCLE_DAYS);
  return { periodFrom, periodTo, expireDate: periodTo, billingDate: periodTo };
}

export function formatReceiptNo(seq: number, at = new Date()) {
  return `R${at.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
}
