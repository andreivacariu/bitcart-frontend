import { invoicesCreatePaymentTransaction } from "#/endpoints/_internal/generated/invoices"

/**
 * Builds an unsigned transaction that pays an invoice's payment method from `account`, with the
 * payer's balances, for in-browser wallets that cannot build it themselves. Called outside React,
 * right before the wallet signs, since the transaction expires within about a minute.
 */
export const createPaymentTransaction = invoicesCreatePaymentTransaction
