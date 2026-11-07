import { bitcartInvoices } from "@bitcart/client-sdk/endpoints"
import type { PaymentTransaction } from "@bitcart/client-sdk/schemas"
import { isApiFailure } from "@bitcart/client-sdk/utils"
import { fromBaseUnits, trimTrailingZeros } from "@bitcart/core/utils"
import { getBase58Decoder, getBase64Encoder } from "@solana/codecs-strings"
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
} from "@solana/wallet-standard-features"
import type { IdentifierString, Wallet, WalletAccount } from "@wallet-standard/base"
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features"

import { getNativeSymbol, getSolanaChain, type WalletNetwork } from "#/checkout/networks"

import { WalletPayError, type WalletSession, type WalletTransfer } from "../types"
import { guard } from "./failures"
import { formatFee } from "./fees"

const LAMPORTS_DECIMALS = 9

//* The API builds the transaction: a Solana wallet exposes no RPC for a recent blockhash or for
//* balances. The blockhash expires about 30 seconds after the API builds the transaction (150
//* blocks of 200 ms), so every call asks for a fresh one. Any failure here is the store's, never
//* the wallet's.
const requestTransaction = async (
  account: string,
  { invoiceId, methodId }: WalletTransfer,
): Promise<PaymentTransaction> => {
  try {
    return await bitcartInvoices.createPaymentTransaction(invoiceId, { id: methodId, account })
  } catch (error) {
    throw new WalletPayError({
      kind: "storeError",
      message: isApiFailure(error) ? error.message : null,
    })
  }
}

const ensureFunds = (funds: PaymentTransaction, transfer: WalletTransfer) => {
  const amount = BigInt(funds.amount)
  const balance = BigInt(funds.balance)
  const fee = BigInt(funds.fee)

  if (balance < amount) {
    throw new WalletPayError({
      kind: "insufficientAmount",
      balance: trimTrailingZeros(fromBaseUnits(balance, funds.decimals)),
    })
  } else if (BigInt(funds.native_balance) < (transfer.contract === null ? amount : 0n) + fee) {
    throw new WalletPayError({
      kind: "insufficientFee",
      fee: formatFee(fee, LAMPORTS_DECIMALS),
      feeSymbol: getNativeSymbol(transfer.network),
    })
  }
}

const supports = (subject: Wallet | WalletAccount, chain: IdentifierString | null) =>
  chain !== null && subject.chains.includes(chain)

export const connectSolanaWallet = async (
  wallet: Wallet,
  network: WalletNetwork,
): Promise<WalletSession> => {
  const chain = getSolanaChain(network)

  const { accounts } = await guard(() =>
    (wallet.features as StandardConnectFeature)[StandardConnect].connect(),
  )()

  const account = accounts.find((candidate) => supports(candidate, chain)) ?? accounts[0]

  if (!account) {
    throw new WalletPayError({ kind: "locked" })
  } else
    return {
      account: account.address,

      //* The Wallet Standard has no way to ask a wallet to switch clusters.
      ensureNetwork: guard(() =>
        supports(wallet, chain) && supports(account, chain)
          ? Promise.resolve()
          : Promise.reject(new WalletPayError({ kind: "unsupportedNetwork" })),
      ),

      checkFunds: guard(async (transfer) =>
        ensureFunds(await requestTransaction(account.address, transfer), transfer),
      ),

      //* Signs a transaction requested right before, with a fresh blockhash, once its own balances
      //* still cover it.
      send: guard(async (transfer) => {
        if (chain === null) throw new WalletPayError({ kind: "unsupportedNetwork" })

        const funds = await requestTransaction(account.address, transfer)

        ensureFunds(funds, transfer)

        const [sent] = await (wallet.features as SolanaSignAndSendTransactionFeature)[
          SolanaSignAndSendTransaction
        ].signAndSendTransaction({
          account,
          chain,
          transaction: new Uint8Array(getBase64Encoder().encode(funds.transaction)),
        })

        if (!sent) {
          throw new WalletPayError({ kind: "error", message: null })
        } else return getBase58Decoder().decode(sent.signature)
      }),
    }
}
