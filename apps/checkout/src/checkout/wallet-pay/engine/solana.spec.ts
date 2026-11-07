import { describe, expect, test } from "vitest"

import type { WalletNetwork } from "#/checkout/networks"
import { servePaymentTransaction, setupCheckoutApiServer } from "#/checkout/testing/api-server"
import {
  createFakeSolanaWallet,
  FAKE_LOCKED_DEVICE_MESSAGE,
  FAKE_SOLANA_ACCOUNT,
  FAKE_SOLANA_TX_HASH,
  type FakeSolanaOptions,
} from "#/checkout/testing/fake-wallets"

import { WalletPayError, type WalletPayFailure, type WalletTransfer } from "../types"
import { connectSolanaWallet } from "./solana"

const SOLANA = { family: "solana", reference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" } as const
const MERCHANT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

const SOL_TRANSFER: WalletTransfer = {
  invoiceId: "invoice-1",
  methodId: "method-sol",
  network: SOLANA,
  to: MERCHANT,
  amount: "0.5",
  contract: null,
  symbol: "sol",
}

const USDC_TRANSFER: WalletTransfer = {
  ...SOL_TRANSFER,
  methodId: "method-usdc",
  amount: "25",
  contract: USDC,
  symbol: "usdc",
}

setupCheckoutApiServer()

const connect = (options: FakeSolanaOptions = {}, network: WalletNetwork = SOLANA) => {
  const fake = createFakeSolanaWallet(options)

  return { fake, session: connectSolanaWallet(fake.wallet, network) }
}

const failureOf = async (promise: Promise<unknown>): Promise<WalletPayFailure> => {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (error instanceof WalletPayError) {
    return error.failure
  } else throw new Error(`Expected a WalletPayError, got ${String(error)}`)
}

describe("connectSolanaWallet", () => {
  test("connects the wallet's account", async () => {
    expect((await connect().session).account).toBe(FAKE_SOLANA_ACCOUNT)
  })

  test.each([
    ["reject", { kind: "rejected" }],
    ["pending", { kind: "pending" }],
    ["locked", { kind: "locked" }],
  ] as const)("reads a %s connection as a failure", async (outcome, failure) => {
    expect(await failureOf(connect({ connect: outcome }).session)).toStrictEqual(failure)
  })

  describe("network", () => {
    test("accepts a wallet on the invoice's cluster", async () => {
      await expect((await connect().session).ensureNetwork()).resolves.toBeUndefined()
    })

    test.each([
      ["a wallet without the invoice's cluster", { chains: ["solana:devnet" as const] }],
      ["an account without the invoice's cluster", { accountChains: ["solana:devnet" as const] }],
    ])("tells %s can't pay, with no cluster to switch to", async (_case, options) => {
      expect(await failureOf((await connect(options).session).ensureNetwork())).toStrictEqual({
        kind: "unsupportedNetwork",
      })
    })

    test("can't pay on a cluster the checkout doesn't know", async () => {
      const requests = servePaymentTransaction()
      const { fake, session } = connect({}, { family: "solana", reference: "1".repeat(32) })

      expect(await failureOf((await session).ensureNetwork())).toStrictEqual({
        kind: "unsupportedNetwork",
      })

      expect(await failureOf((await session).send(SOL_TRANSFER))).toStrictEqual({
        kind: "unsupportedNetwork",
      })

      expect(requests).toStrictEqual([])
      expect(fake.sent).toStrictEqual([])
    })
  })

  describe("funds", () => {
    test("asks the API for the payer's funds on the invoice's payment method", async () => {
      const requests = servePaymentTransaction()

      await (await connect().session).checkFunds(SOL_TRANSFER)

      expect(requests).toStrictEqual([
        { invoiceId: "invoice-1", body: { id: "method-sol", account: FAKE_SOLANA_ACCOUNT } },
      ])
    })

    test("reports the balance short of the amount, without trailing zeros", async () => {
      servePaymentTransaction({ amount: "500000000", balance: "100000000" })

      expect(await failureOf((await connect().session).checkFunds(SOL_TRANSFER))).toStrictEqual({
        kind: "insufficientAmount",
        balance: "0.1",
      })
    })

    test("reports the fee a balance covering only the amount can't pay, rounded up", async () => {
      servePaymentTransaction({
        amount: "500000000",
        balance: "500000000",
        native_balance: "500000000",
        fee: "2049280",
      })

      expect(await failureOf((await connect().session).checkFunds(SOL_TRANSFER))).toStrictEqual({
        kind: "insufficientFee",
        fee: "0.0021",
        feeSymbol: "SOL",
      })
    })

    test("checks a token's own balance in its own decimals", async () => {
      servePaymentTransaction({ decimals: 6, amount: "25000000", balance: "24990000" })

      expect(await failureOf((await connect().session).checkFunds(USDC_TRANSFER))).toStrictEqual({
        kind: "insufficientAmount",
        balance: "24.99",
      })
    })

    test("asks for the network fee and rent in SOL on a token payment", async () => {
      servePaymentTransaction({
        decimals: 6,
        amount: "5000000",
        balance: "100000000",
        fee: "2044280",
        native_balance: "2000000",
      })

      expect(await failureOf((await connect().session).checkFunds(USDC_TRANSFER))).toStrictEqual({
        kind: "insufficientFee",
        fee: "0.0021",
        feeSymbol: "SOL",
      })
    })

    test("needs SOL only for the fee of a token payment", async () => {
      servePaymentTransaction({
        decimals: 6,
        amount: "25000000",
        balance: "25000000",
        fee: "5000",
        native_balance: "5000",
      })

      await expect((await connect().session).checkFunds(USDC_TRANSFER)).resolves.toBeUndefined()
    })

    test.each([
      ["a refusal", { status: 422, detail: "Invoice is not pending" }, "Invoice is not pending"],
      [
        "a rate limit",
        { status: 429, detail: "Too many payment transaction requests, try again later" },
        "Too many payment transaction requests, try again later",
      ],
      ["a dropped connection", "networkError", null],
    ] as const)("reads %s from the API as the store's failure", async (_case, answer, message) => {
      servePaymentTransaction(answer)

      expect(await failureOf((await connect().session).checkFunds(SOL_TRANSFER))).toStrictEqual({
        kind: "storeError",
        message,
      })
    })
  })

  describe("sending", () => {
    test("signs and sends the API's transaction on the invoice's cluster", async () => {
      const requests = servePaymentTransaction()
      const { fake, session } = connect()

      expect(await (await session).send(SOL_TRANSFER)).toBe(FAKE_SOLANA_TX_HASH)

      expect(requests).toHaveLength(1)

      expect(fake.sent).toStrictEqual([
        {
          account: fake.account,
          chain: "solana:mainnet",
          transaction: Uint8Array.from([1, 2, 3, 4, 5]),
        },
      ])

      expect(fake.sent[0]?.account).toBe(fake.account)
    })

    test("asks for a fresh transaction on every attempt and signs the latest", async () => {
      const requests = servePaymentTransaction([
        { decimals: 6, amount: "25000000", transaction: "AQID" },
        { decimals: 6, amount: "25000000", transaction: "BAUG" },
      ])

      const { fake, session } = connect()

      await (await session).checkFunds(USDC_TRANSFER)
      await (await session).send(USDC_TRANSFER)

      expect(requests.map(({ body }) => body.id)).toStrictEqual(["method-usdc", "method-usdc"])

      expect(fake.sent.map(({ transaction }) => transaction)).toStrictEqual([
        Uint8Array.from([4, 5, 6]),
      ])
    })

    test("checks the funds again on the transaction it signs", async () => {
      servePaymentTransaction([{}, { amount: "500000000", balance: "100000000" }])

      const { fake, session } = connect()

      await (await session).checkFunds(SOL_TRANSFER)

      expect(await failureOf((await session).send(SOL_TRANSFER))).toStrictEqual({
        kind: "insufficientAmount",
        balance: "0.1",
      })

      expect(fake.sent).toStrictEqual([])
    })

    test.each([
      ["with Phantom's 4001 code", "reject"],
      ["by a Wallet Standard adapter", "declined"],
    ] as const)("reads a payment declined %s as rejected", async (_case, send) => {
      servePaymentTransaction()

      expect(await failureOf((await connect({ send }).session).send(SOL_TRANSFER))).toStrictEqual({
        kind: "rejected",
      })
    })

    test("keeps the message of an adapter's signing error other than a decline", async () => {
      servePaymentTransaction()

      expect(
        await failureOf((await connect({ send: "deviceLocked" }).session).send(SOL_TRANSFER)),
      ).toStrictEqual({ kind: "error", message: FAKE_LOCKED_DEVICE_MESSAGE })
    })

    test("keeps the wallet's message for any other failure", async () => {
      servePaymentTransaction()

      expect(
        await failureOf((await connect({ send: "fail" }).session).send(SOL_TRANSFER)),
      ).toStrictEqual({ kind: "error", message: "Provider error -32603" })
    })

    test("doesn't ask the wallet to sign a transaction the API refused", async () => {
      servePaymentTransaction({ status: 404, detail: "No such payment method found" })

      const { fake, session } = connect()

      expect(await failureOf((await session).send(SOL_TRANSFER))).toStrictEqual({
        kind: "storeError",
        message: "No such payment method found",
      })

      expect(fake.sent).toStrictEqual([])
    })
  })
})
