import { describe, expect, test } from "vitest"

import {
  getMethodNetwork,
  getNativeSymbol,
  getNetworkLabels,
  getSolanaChain,
  parseWalletNetwork,
} from "./networks"

const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
const SOLANA_TESTNET = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z"

describe("parseWalletNetwork", () => {
  test.each([
    ["eip155:1", { family: "eip155", reference: "1" }],
    ["tron:728126428", { family: "tron", reference: "728126428" }],
    [SOLANA_MAINNET, { family: "solana", reference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }],
  ])("reads %s", (caip2, network) => {
    expect(parseWalletNetwork(caip2)).toStrictEqual(network)
  })

  test.each([
    null,
    "bip122:000000000019d6689c085ae165831e93",
    "eip155:",
    "eip155:1:extra",
    "eip155:0x1",
    "solana:mainnet",
    "solana:0eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "toString:1",
  ])("covers no network from %j", (caip2) => {
    expect(parseWalletNetwork(caip2)).toBeNull()
  })
})

describe("getNetworkLabels", () => {
  test("names a known network", () => {
    expect(getNetworkLabels("eip155:56")).toStrictEqual({ badge: "BSC", name: "BNB Smart Chain" })
  })

  test.each([
    [SOLANA_MAINNET, { badge: "SOL", name: "Solana" }],
    [SOLANA_DEVNET, { badge: "Devnet", name: "Solana Devnet" }],
    [SOLANA_TESTNET, { badge: "Testnet", name: "Solana Testnet" }],
  ])("names the Solana cluster %s", (caip2, labels) => {
    expect(getNetworkLabels(caip2)).toStrictEqual(labels)
  })

  test("badges an unknown network with its chain id, leaving it unnamed", () => {
    expect(getNetworkLabels("eip155:43114")).toStrictEqual({ badge: "43114", name: null })
  })
})

describe("getNativeSymbol", () => {
  test.each([
    ["eip155:137", "POL"],
    ["tron:728126428", "TRX"],
    [SOLANA_DEVNET, "SOL"],
  ])("pays fees on %s in %s", (caip2, symbol) => {
    const network = parseWalletNetwork(caip2)

    expect(network && getNativeSymbol(network)).toBe(symbol)
  })
})

describe("getSolanaChain", () => {
  test.each([
    [SOLANA_MAINNET, "solana:mainnet"],
    [SOLANA_DEVNET, "solana:devnet"],
    [SOLANA_TESTNET, "solana:testnet"],
    ["solana:11111111111111111111111111111111", null],
    ["eip155:1", null],
  ])("names %s for wallets as %s", (caip2, chain) => {
    const network = parseWalletNetwork(caip2)

    expect(network && getSolanaChain(network)).toBe(chain)
  })
})

describe("getMethodNetwork", () => {
  test("prefers the backend's network", () => {
    expect(getMethodNetwork({ network: "tron:728126428", chainId: 1 })).toBe("tron:728126428")
  })

  test("falls back to the chain id of an EIP-681 payment URI", () => {
    expect(getMethodNetwork({ network: null, chainId: 137 })).toBe("eip155:137")
  })

  test("has no network without either", () => {
    expect(getMethodNetwork({ network: null, chainId: null })).toBeNull()
  })
})
