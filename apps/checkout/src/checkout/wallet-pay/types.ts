import type { Wallet } from "@wallet-standard/base"

import type { WalletNetwork } from "../networks"

export type Eip1193Request = (args: { method: string; params?: unknown }) => Promise<unknown>

export type Eip1193Provider = { request: Eip1193Request }

export type InjectedTronWeb = {
  defaultAddress: { base58: string | false }
  trx: {
    getBlockByNumber: (block: number) => Promise<{ blockID: string }>
    getBalance: (address: string) => Promise<number>
    sign: (transaction: unknown) => Promise<{ txID: string }>
    sendRawTransaction: (signed: unknown) => Promise<{ result?: boolean; txid?: string }>
  }
  transactionBuilder: {
    sendTrx: (to: string, amount: number, from: string) => Promise<unknown>
  }
  contract: (
    abi: readonly unknown[],
    address: string,
  ) => {
    decimals: () => { call: () => Promise<unknown> }
    balanceOf: (owner: string) => { call: () => Promise<unknown> }
    transfer: (to: string, amount: string) => { send: (options: object) => Promise<string> }
  }
}

export type TronProtocol = "tip1193" | "legacy" | "bare"

export type TronProvider = {
  protocol: TronProtocol
  request?: Eip1193Request
  getTronWeb: () => InjectedTronWeb | null
}

type InjectedWalletInfo = {
  id: string
  name: string | null
  icon: string | null
  logoId?: string
}

export type InjectedWallet =
  | (InjectedWalletInfo & { family: "eip155"; provider: Eip1193Provider })
  | (InjectedWalletInfo & { family: "tron"; provider: TronProvider })
  | (InjectedWalletInfo & { family: "solana"; provider: Wallet })

//* `invoiceId` and `methodId` let an engine ask the API to build the transaction, for wallets
//* that only sign and send what they are given.
export type WalletTransfer = {
  invoiceId: string
  methodId: string
  network: WalletNetwork
  to: string
  amount: string
  contract: string | null
  symbol: string
}

//* `unsupportedNetwork` is a wallet that can't be switched to the invoice's network, unlike
//* `wrongNetwork`. `storeError` is the store failing to prepare the payment, with its reason if it
//* gave one.
export type WalletPayFailure =
  | { kind: "rejected" }
  | { kind: "pending" }
  | { kind: "locked" }
  | { kind: "wrongNetwork" }
  | { kind: "unsupportedNetwork" }
  | { kind: "insufficientAmount"; balance: string }
  | { kind: "insufficientFee"; fee: string; feeSymbol: string }
  | { kind: "error"; message: string | null }
  | { kind: "storeError"; message: string | null }

export class WalletPayError extends Error {
  readonly failure: WalletPayFailure

  constructor(failure: WalletPayFailure) {
    super(failure.kind)
    this.name = "WalletPayError"
    this.failure = failure
  }
}

export type WalletSession = {
  account: string
  ensureNetwork: () => Promise<void>
  checkFunds: (transfer: WalletTransfer) => Promise<void>
  send: (transfer: WalletTransfer) => Promise<string>
}
