export type WalletFamily = "eip155" | "tron" | "solana"

//* `reference` is the CAIP-2 reference: a decimal chain id for EIP-155 and TRON, a genesis hash
//* prefix for Solana.
export type WalletNetwork = {
  family: WalletFamily
  reference: string
}

const REFERENCE_PATTERNS: Record<WalletFamily, RegExp> = {
  eip155: /^\d+$/u,
  tron: /^\d+$/u,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32}$/u,
}

const isWalletFamily = (namespace: string): namespace is WalletFamily =>
  Object.hasOwn(REFERENCE_PATTERNS, namespace)

export const parseWalletNetwork = (caip2: string | null): WalletNetwork | null => {
  const [namespace = "", reference = "", ...rest] = caip2?.split(":") ?? []

  if (
    rest.length === 0 &&
    isWalletFamily(namespace) &&
    REFERENCE_PATTERNS[namespace].test(reference)
  ) {
    return { family: namespace, reference }
  } else return null
}

const SOLANA_MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
const SOLANA_DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
const SOLANA_TESTNET = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z"

const NETWORK_NAMES: Record<WalletFamily, Partial<Record<string, string>>> = {
  eip155: {
    1: "Ethereum",
    11155111: "Sepolia",
    56: "BNB Smart Chain",
    97: "BNB Smart Chain Testnet",
    137: "Polygon",
    80002: "Polygon Amoy",
  },

  tron: {
    728126428: "TRON",
    2494104990: "TRON Shasta",
    3448148188: "TRON Nile",
  },

  solana: {
    [SOLANA_MAINNET]: "Solana",
    [SOLANA_DEVNET]: "Solana Devnet",
    [SOLANA_TESTNET]: "Solana Testnet",
  },
}

export const getNetworkName = ({ family, reference }: WalletNetwork): string | null =>
  NETWORK_NAMES[family][reference] ?? null

const NATIVE_SYMBOLS: Record<WalletFamily, Partial<Record<string, string>>> = {
  eip155: { 56: "BNB", 97: "tBNB", 137: "POL", 80002: "POL" },
  tron: {},
  solana: {},
}

const DEFAULT_NATIVE_SYMBOLS: Record<WalletFamily, string> = {
  eip155: "ETH",
  tron: "TRX",
  solana: "SOL",
}

export const getNativeSymbol = ({ family, reference }: WalletNetwork): string =>
  NATIVE_SYMBOLS[family][reference] ?? DEFAULT_NATIVE_SYMBOLS[family]

const NETWORK_BADGES: Record<WalletFamily, Partial<Record<string, string>>> = {
  eip155: {
    1: "ETH",
    11155111: "Sepolia",
    56: "BSC",
    97: "BSC Testnet",
    137: "POL",
    80002: "Amoy",
  },

  tron: { 728126428: "TRX", 2494104990: "Shasta", 3448148188: "Nile" },

  solana: { [SOLANA_MAINNET]: "SOL", [SOLANA_DEVNET]: "Devnet", [SOLANA_TESTNET]: "Testnet" },
}

export type NetworkLabels = { badge: string; name: string | null }

export const getNetworkLabels = (caip2: string | null): NetworkLabels | null => {
  const network = parseWalletNetwork(caip2)

  if (network === null) {
    return null
  } else {
    const { family, reference } = network

    return {
      badge: NETWORK_BADGES[family][reference] ?? reference,
      name: getNetworkName(network),
    }
  }
}

type SolanaWalletChain = `solana:${string}`

//* Solana wallets name a cluster by a Wallet Standard chain, not by its CAIP-2 id.
const SOLANA_WALLET_CHAINS: Partial<Record<string, SolanaWalletChain>> = {
  [SOLANA_MAINNET]: "solana:mainnet",
  [SOLANA_DEVNET]: "solana:devnet",
  [SOLANA_TESTNET]: "solana:testnet",
}

export const SOLANA_CHAINS: readonly string[] = Object.values(SOLANA_WALLET_CHAINS).filter(
  (chain) => chain !== undefined,
)

export const getSolanaChain = ({ family, reference }: WalletNetwork): SolanaWalletChain | null =>
  family === "solana" ? (SOLANA_WALLET_CHAINS[reference] ?? null) : null

export const getMethodNetwork = ({
  network,
  chainId,
}: {
  network: string | null
  chainId: number | null
}): string | null => network ?? (chainId === null ? null : `eip155:${chainId}`)
