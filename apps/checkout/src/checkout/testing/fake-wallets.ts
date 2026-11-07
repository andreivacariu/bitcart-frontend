import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignAndSendTransactionInput,
} from "@solana/wallet-standard-features"
import type { IdentifierString, Wallet, WalletAccount } from "@wallet-standard/base"
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features"

import type {
  Eip1193Provider,
  Eip1193Request,
  InjectedTronWeb,
  TronProvider,
} from "../wallet-pay/types"

export const FAKE_EVM_ACCOUNT = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
export const FAKE_TRON_ACCOUNT = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8"
export const FAKE_SOLANA_ACCOUNT = "EWmDvi3hhz86LYi2NcD6YUp18DeeB5gDkwJzde3MgF9A"
export const FAKE_TX_HASH = `0x${"ab".repeat(32)}`

//* The bytes 1 to 64, as the signature a Solana wallet returns.
export const FAKE_SOLANA_SIGNATURE = Uint8Array.from({ length: 64 }, (_, index) => index + 1)

//* That signature in base58: the transaction hash.
export const FAKE_SOLANA_TX_HASH =
  "2Ana1pUpv2ZbMVkwF5FXapYeBEjdxDatLn7nvJkhgTSXbs59SyZSx866bXirPgj8QQVB57uxHJBG1YFvkRbFj4T"

//* The bytes 1 to 5, standing in for a serialized transaction.
export const FAKE_SOLANA_TRANSACTION = "AQIDBAU="

const PLENTY = 10n ** 30n

export class FakeProviderError extends Error {
  readonly code: number

  constructor(code: number) {
    super(`Provider error ${code}`)
    this.code = code
  }
}

type Outcome = "accept" | "reject" | "pending" | "fail"

const fail = (outcome: Exclude<Outcome, "accept">) =>
  Promise.reject(new FakeProviderError({ reject: 4001, pending: -32002, fail: -32603 }[outcome]))

const DECIMALS_SELECTOR = "0x313ce567"

const toWord = (value: bigint | number) => `0x${value.toString(16).padStart(64, "0")}`

export type FakeEvmOptions = {
  account?: string
  chainId?: number
  nativeBalance?: bigint
  tokenBalance?: bigint
  tokenDecimals?: number
  gas?: bigint
  gasPrice?: bigint
  connect?: Outcome
  switchChain?: Outcome
  send?: Outcome
}

const toHex = (value: bigint | number) => `0x${value.toString(16)}`

export const createFakeEvmProvider = ({
  account = FAKE_EVM_ACCOUNT,
  chainId: initialChainId = 1,
  nativeBalance = PLENTY,
  tokenBalance = PLENTY,
  tokenDecimals = 6,
  gas = 21_000n,
  gasPrice = 10n ** 9n,
  connect = "accept",
  switchChain = "accept",
  send = "accept",
}: FakeEvmOptions = {}) => {
  let chainId = initialChainId
  const calls: { method: string; params?: unknown }[] = []

  const request: Eip1193Request = ({ method, params }) => {
    calls.push({ method, params })

    const [first] = (params ?? []) as [Record<string, string> | undefined]

    switch (method) {
      case "eth_requestAccounts":
        return connect === "accept" ? Promise.resolve([account]) : fail(connect)

      case "eth_chainId":
        return Promise.resolve(toHex(chainId))

      case "wallet_switchEthereumChain":
        if (switchChain === "accept") {
          chainId = Number(first?.chainId)

          return Promise.resolve(null)
        } else return fail(switchChain)

      case "wallet_requestPermissions":
        return Promise.resolve([])

      case "eth_getBalance":
        return Promise.resolve(toHex(nativeBalance))

      case "eth_call":
        return Promise.resolve(
          toWord(first?.data?.startsWith(DECIMALS_SELECTOR) ? tokenDecimals : tokenBalance),
        )

      case "eth_estimateGas":
        return Promise.resolve(toHex(gas))

      case "eth_getBlockByNumber":
        return Promise.resolve({ number: "0x1", baseFeePerGas: toHex(gasPrice) })

      case "eth_maxPriorityFeePerGas":
        return Promise.resolve("0x0")

      case "eth_gasPrice":
        return Promise.resolve(toHex(gasPrice))

      case "eth_sendTransaction":
        return send === "accept" ? Promise.resolve(FAKE_TX_HASH) : fail(send)

      default:
        return Promise.reject(new FakeProviderError(4200))
    }
  }

  const provider: Eip1193Provider = { request }

  return { provider, calls, getChainId: () => chainId }
}

export type FakeTronOptions = {
  protocol?: TronProvider["protocol"]
  chainId?: number
  trxBalance?: number
  tokenBalance?: unknown
  tokenDecimals?: unknown
  connect?: Outcome | "locked"
  switchChain?: Outcome
  sign?: Outcome
}

const MAINNET_CHAIN_ID = 728126428
const TRON_DECLINED = "Confirmation declined by user"

export const createFakeTronProvider = ({
  protocol = "tip1193",
  chainId: initialChainId = MAINNET_CHAIN_ID,
  trxBalance = 10 ** 12,
  tokenBalance = PLENTY,
  tokenDecimals = 6n,
  connect = "accept",
  switchChain = "accept",
  sign = "accept",
}: FakeTronOptions = {}) => {
  let chainId = initialChainId
  const sent: { kind: "trx" | "trc20"; to: string; amount: string; contract?: string }[] = []

  const signOutcome = () => {
    if (sign === "accept") {
      return Promise.resolve("c0ffee")
    } else if (sign === "reject") {
      return Promise.reject(TRON_DECLINED as unknown as Error)
    } else return fail(sign)
  }

  const tronWeb: InjectedTronWeb = {
    defaultAddress: { base58: protocol === "bare" ? FAKE_TRON_ACCOUNT : false },

    trx: {
      getBlockByNumber: () =>
        Promise.resolve({ blockID: `${"0".repeat(56)}${chainId.toString(16).padStart(8, "0")}` }),

      getBalance: () => Promise.resolve(trxBalance),
      sign: () => signOutcome().then((txID) => ({ txID })),
      sendRawTransaction: () => Promise.resolve({ result: true, txid: "c0ffee" }),
    },

    transactionBuilder: {
      sendTrx: (to, amount) => {
        sent.push({ kind: "trx", to, amount: String(amount) })

        return Promise.resolve({})
      },
    },

    contract: (_abi, contract) => ({
      decimals: () => ({ call: () => Promise.resolve(tokenDecimals) }),
      balanceOf: () => ({ call: () => Promise.resolve(tokenBalance) }),

      transfer: (to, amount) => ({
        send: () => {
          sent.push({ kind: "trc20", to, amount, contract })

          return signOutcome()
        },
      }),
    }),
  }

  const connectOutcome = () => {
    if (protocol === "legacy") {
      const codes = { accept: 200, reject: 4001, pending: 4000, fail: 500, locked: undefined }

      return Promise.resolve(connect === "locked" ? "" : { code: codes[connect] })
    } else if (connect === "accept") {
      return Promise.resolve([FAKE_TRON_ACCOUNT])
    } else return fail(connect === "locked" ? "fail" : connect)
  }

  const request: Eip1193Request = ({ method, params }) => {
    if (method === "eth_requestAccounts" || method === "tron_requestAccounts") {
      return connectOutcome().then((answer) => {
        if (connect === "accept") tronWeb.defaultAddress.base58 = FAKE_TRON_ACCOUNT

        return answer
      })
    } else if (method === "wallet_switchEthereumChain") {
      if (switchChain === "accept") {
        chainId = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16)

        return Promise.resolve(null)
      } else return fail(switchChain)
    } else return Promise.reject(new FakeProviderError(4200))
  }

  const provider: TronProvider = {
    protocol,
    request: protocol === "bare" ? undefined : request,
    getTronWeb: () => tronWeb,
  }

  return { provider, tronWeb, sent, getChainId: () => chainId }
}

export type FakeSolanaOptions = {
  chains?: IdentifierString[]
  accountChains?: IdentifierString[]
  connect?: Outcome | "locked"

  //* `declined` and `deviceLocked` throw like a Wallet Standard adapter: a
  //* `WalletSignTransactionError` keeping the message of the error behind it, without a code.
  send?: Outcome | keyof typeof ADAPTER_MESSAGES
}

export const FAKE_LOCKED_DEVICE_MESSAGE = "Ledger device: Locked device (0x5515)"

const ADAPTER_MESSAGES = {
  declined: "User rejected the request.",
  deviceLocked: FAKE_LOCKED_DEVICE_MESSAGE,
}

export const createFakeSolanaWallet = ({
  chains = ["solana:mainnet", "solana:devnet"],
  accountChains = chains,
  connect = "accept",
  send = "accept",
}: FakeSolanaOptions = {}) => {
  const sent: SolanaSignAndSendTransactionInput[] = []

  const account: WalletAccount = {
    address: FAKE_SOLANA_ACCOUNT,
    publicKey: Uint8Array.from({ length: 32 }, (_, index) => 200 - index),
    chains: accountChains,
    features: [SolanaSignAndSendTransaction],
  }

  const features: StandardConnectFeature & SolanaSignAndSendTransactionFeature = {
    [StandardConnect]: {
      version: "1.0.0",

      connect: () => {
        if (connect === "accept") {
          return Promise.resolve({ accounts: [account] })
        } else if (connect === "locked") {
          return Promise.resolve({ accounts: [] })
        } else return fail(connect)
      },
    },

    [SolanaSignAndSendTransaction]: {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy", 0],

      signAndSendTransaction: (...inputs) => {
        sent.push(...inputs)

        if (send === "accept") {
          return Promise.resolve([{ signature: FAKE_SOLANA_SIGNATURE }])
        } else if (send === "declined" || send === "deviceLocked") {
          return Promise.reject(
            Object.assign(new Error(ADAPTER_MESSAGES[send]), {
              name: "WalletSignTransactionError",
            }),
          )
        } else return fail(send)
      },
    },
  }

  const wallet: Wallet = {
    version: "1.0.0",
    name: "Test Solana Wallet",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains,
    features,
    accounts: [],
  }

  return { wallet, account, sent }
}
