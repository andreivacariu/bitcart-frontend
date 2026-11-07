import type { WalletNetwork } from "#/checkout/networks"

import type { InjectedWallet, WalletSession } from "../types"
import { connectEvmWallet } from "./evm"
import { connectSolanaWallet } from "./solana"
import { connectTronWallet } from "./tron"

export const connectWallet = (
  wallet: InjectedWallet,
  network: WalletNetwork,
): Promise<WalletSession> => {
  switch (wallet.family) {
    case "eip155":
      return connectEvmWallet(wallet.provider, network)

    case "tron":
      return connectTronWallet(wallet.provider, network)

    case "solana":
      return connectSolanaWallet(wallet.provider, network)
  }
}
