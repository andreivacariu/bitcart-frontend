import { WalletPayError, type WalletPayFailure } from "../types"

const USER_REJECTED_CODE = 4001
const REQUEST_PENDING_CODE = -32002

const TRON_DECLINED_MESSAGE = "Confirmation declined by user"

//* Solana wallets without a 4001 code say so only in the message. Wallet Standard adapters wrap
//* every signing failure, a locked device included, in a `WalletSignTransactionError`, keeping the
//* message of the error behind it.
const SOLANA_DECLINED_MESSAGE = /\buser (?:rejected|declined|denied|cancel+ed)\b/iu

const findCode = (error: unknown, depth = 0): number | null => {
  if (typeof error !== "object" || error === null || depth > 5) {
    return null
  } else if ("code" in error && typeof error.code === "number") {
    return error.code
  } else return "cause" in error ? findCode(error.cause, depth + 1) : null
}

const getMessage = (error: unknown): string | null => {
  if (typeof error === "string") {
    return error
  } else if (error instanceof Error) {
    return "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : error.message
  } else return null
}

export const toWalletPayFailure = (error: unknown): WalletPayFailure => {
  const code = findCode(error)

  if (error instanceof WalletPayError) {
    return error.failure
  } else if (
    code === USER_REJECTED_CODE ||
    error === TRON_DECLINED_MESSAGE ||
    (error instanceof Error && SOLANA_DECLINED_MESSAGE.test(error.message))
  ) {
    return { kind: "rejected" }
  } else if (code === REQUEST_PENDING_CODE) {
    return { kind: "pending" }
  } else return { kind: "error", message: getMessage(error) }
}

export const guard =
  <TArgs extends unknown[], TResult>(call: (...args: TArgs) => Promise<TResult>) =>
  async (...args: TArgs): Promise<TResult> => {
    try {
      return await call(...args)
    } catch (error) {
      throw new WalletPayError(toWalletPayFailure(error))
    }
  }
