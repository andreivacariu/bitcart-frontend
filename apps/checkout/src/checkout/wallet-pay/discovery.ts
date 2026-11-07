import { SolanaSignAndSendTransaction } from "@solana/wallet-standard-features"
import { createStore } from "@tanstack/store"
import { getWallets } from "@wallet-standard/app"
import type { Wallet } from "@wallet-standard/base"
import { StandardConnect } from "@wallet-standard/features"

import { getSolanaChain, SOLANA_CHAINS, type WalletFamily, type WalletNetwork } from "../networks"
import type { Eip1193Request, InjectedTronWeb, InjectedWallet, TronProvider } from "./types"

export type WalletDiscoveryState = {
  announced: InjectedWallet[]
  legacy: InjectedWallet[]
}

export type WalletDiscoveryActions = {
  announce: (wallet: InjectedWallet) => void
  forget: (provider: object) => void
  detectLegacy: (wallets: InjectedWallet[]) => void
}

export const createWalletDiscovery = () =>
  createStore<WalletDiscoveryState, WalletDiscoveryActions>(
    { announced: [], legacy: [] },

    ({ setState }) => ({
      announce: (wallet) =>
        setState((state) => {
          const current = state.announced.find(({ id }) => id === wallet.id)

          if (current?.provider === wallet.provider) {
            return state
          } else
            return {
              ...state,
              announced: [...state.announced.filter(({ id }) => id !== wallet.id), wallet],
            }
        }),

      forget: (provider) =>
        setState((state) =>
          state.announced.some((wallet) => wallet.provider === provider)
            ? {
                ...state,
                announced: state.announced.filter((wallet) => wallet.provider !== provider),
              }
            : state,
        ),

      detectLegacy: (wallets) =>
        setState((state) => {
          const isSame =
            wallets.length === state.legacy.length &&
            wallets.every((wallet, index) => wallet.provider === state.legacy[index]?.provider)

          return isSame ? state : { ...state, legacy: wallets }
        }),
    }),
  )

export type WalletDiscovery = ReturnType<typeof createWalletDiscovery>

//* A Solana wallet is listed only on a cluster it supports: the Wallet Standard can't switch one.
export const selectInjectedWallets = (
  { announced, legacy }: WalletDiscoveryState,
  network: WalletNetwork,
): InjectedWallet[] => {
  const ofFamily = announced.filter((wallet) => wallet.family === network.family)

  if (network.family === "solana") {
    const chain = getSolanaChain(network)

    return ofFamily.filter(
      (wallet) =>
        wallet.family === "solana" && chain !== null && wallet.provider.chains.includes(chain),
    )
  } else
    return ofFamily.length > 0
      ? ofFamily
      : legacy.filter((wallet) => wallet.family === network.family)
}

type AnnouncedInfo = { uuid?: unknown; name?: unknown; icon?: unknown }

type AnnouncedProvider = { request?: unknown; tronWeb?: unknown }

type AnnounceDetail = { info?: AnnouncedInfo; provider?: AnnouncedProvider }

const toIcon = (icon: unknown): string | null =>
  typeof icon === "string" && icon.startsWith("data:image/") ? icon : null

const isRequest = (value: unknown): value is Eip1193Request => typeof value === "function"

const asTronWeb = (value: unknown): InjectedTronWeb | null =>
  typeof value === "object" && value !== null && "trx" in value ? (value as InjectedTronWeb) : null

//* Solana wallets register through the Wallet Standard instead of announcing themselves.
type AnnouncedFamily = Exclude<WalletFamily, "solana">

const toAnnouncedId = (family: AnnouncedFamily, detail: unknown): string =>
  `${family}:${String((detail as AnnounceDetail | undefined)?.info?.uuid)}`

const toAnnouncedWallet = (family: AnnouncedFamily, detail: unknown): InjectedWallet | null => {
  const { info, provider } = (detail ?? {}) as AnnounceDetail

  if (
    typeof info?.uuid !== "string" ||
    typeof info.name !== "string" ||
    !provider ||
    !isRequest(provider.request)
  ) {
    return null
  } else {
    const base = { id: toAnnouncedId(family, detail), name: info.name, icon: toIcon(info.icon) }

    const request: Eip1193Request = (args) =>
      (provider as { request: Eip1193Request }).request(args)

    if (family === "eip155") {
      return { ...base, family, provider: { request } }
    } else
      return {
        ...base,
        family,
        provider: { protocol: "tip1193", request, getTronWeb: () => asTronWeb(provider.tronWeb) },
      }
  }
}

type InjectedTronLink = { isTronLink?: unknown; request?: unknown; tronWeb?: unknown }

type InjectedGlobals = {
  ethereum?: { request?: unknown }
  tron?: InjectedTronLink
  tronLink?: InjectedTronLink
  tronWeb?: unknown
  trustwallet?: { tron?: InjectedTronLink; tronLink?: InjectedTronLink }
}

type FoundTron = { source: object; provider: TronProvider }

const toTronLinkProvider = (source: InjectedTronLink): FoundTron | null => {
  if (isRequest(source.request)) {
    const request = source.request.bind(source) as Eip1193Request

    return {
      source,
      provider: { protocol: "legacy", request, getTronWeb: () => asTronWeb(source.tronWeb) },
    }
  } else if (asTronWeb(source.tronWeb)) {
    return { source, provider: { protocol: "bare", getTronWeb: () => asTronWeb(source.tronWeb) } }
  } else return null
}

const findLegacyTron = (globals: InjectedGlobals): FoundTron | null => {
  const { tron, tronLink } = globals

  if (tron?.isTronLink && isRequest(tron.request)) {
    const request = tron.request.bind(tron) as Eip1193Request

    return {
      source: tron,
      provider: { protocol: "tip1193", request, getTronWeb: () => asTronWeb(tron.tronWeb) },
    }
  } else if (tronLink && isRequest(tronLink.request)) {
    return toTronLinkProvider(tronLink)
  } else if (asTronWeb(globals.tronWeb)) {
    const tronWeb = globals.tronWeb as object

    return { source: tronWeb, provider: { protocol: "bare", getTronWeb: () => asTronWeb(tronWeb) } }
  } else return null
}

const findTrustTron = ({ trustwallet }: InjectedGlobals): FoundTron | null => {
  const source = trustwallet?.tron ?? trustwallet?.tronLink

  return source ? toTronLinkProvider(source) : null
}

const isSameTron = (found: FoundTron, other: FoundTron) =>
  found.source === other.source ||
  found.source === (other.source as InjectedTronLink).tronWeb ||
  (found.source as InjectedTronLink).tronWeb === other.source

export const findLegacyWallets = (globals: InjectedGlobals): InjectedWallet[] => {
  const { ethereum, tron } = globals
  const trustTron = findTrustTron(globals)
  const legacyTron = findLegacyTron(globals)

  const otherTron =
    legacyTron && !(trustTron && isSameTron(legacyTron, trustTron)) ? legacyTron : null

  return [
    ...(ethereum && isRequest(ethereum.request)
      ? [
          {
            family: "eip155" as const,
            id: "legacy:ethereum",
            name: null,
            icon: null,
            provider: { request: ethereum.request.bind(ethereum) as Eip1193Request },
          },
        ]
      : []),

    ...(trustTron
      ? [
          {
            family: "tron" as const,
            id: "legacy:tron:trust",
            name: "Trust Wallet",
            icon: null,
            logoId: "trust",
            provider: trustTron.provider,
          },
        ]
      : []),

    ...(otherTron
      ? [
          {
            family: "tron" as const,
            id: `legacy:tron:${otherTron.provider.protocol}`,
            name: tron?.isTronLink ? "TronLink" : null,
            icon: null,
            provider: otherTron.provider,
          },
        ]
      : []),
  ]
}

const ANNOUNCE_EVENTS = {
  eip155: { request: "eip6963:requestProvider", announce: "eip6963:announceProvider" },
  tron: { request: "TIP6963:requestProvider", announce: "TIP6963:announceProvider" },
} as const satisfies Record<AnnouncedFamily, { request: string; announce: string }>

const LEGACY_RECHECK_DELAYS_MS = [500, 2000]

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

//* A Solana wallet that can connect and pay on a cluster the checkout knows. Extensions register
//* any object, so a malformed one is ignored instead of breaking the checkout.
const toStandardWallet = (wallet: Wallet): InjectedWallet | null => {
  const { name, chains, features, accounts } = wallet as { [Key in keyof Wallet]?: unknown }

  return typeof name === "string" &&
    isStrings(chains) &&
    chains.some((chain) => SOLANA_CHAINS.includes(chain)) &&
    typeof features === "object" &&
    features !== null &&
    StandardConnect in features &&
    SolanaSignAndSendTransaction in features &&
    Array.isArray(accounts)
    ? { family: "solana", id: `solana:${name}`, name, icon: toIcon(wallet.icon), provider: wallet }
    : null
}

const watchStandardWallets = (discovery: WalletDiscovery): (() => void) => {
  const wallets = getWallets()

  const register = (...registered: Wallet[]) => {
    for (const wallet of registered) {
      const injected = toStandardWallet(wallet)

      if (injected) discovery.actions.announce(injected)
    }
  }

  register(...wallets.get())

  const stops = [
    wallets.on("register", register),

    wallets.on("unregister", (...unregistered) => {
      for (const wallet of unregistered) discovery.actions.forget(wallet)
    }),
  ]

  return () => {
    for (const stop of stops) stop()
  }
}

export const watchInjectedWallets = (
  discovery: WalletDiscovery,
  target: Window = window,
): (() => void) => {
  const globals = target as unknown as InjectedGlobals
  const detectLegacy = () => discovery.actions.detectLegacy(findLegacyWallets(globals))

  const listeners = (Object.keys(ANNOUNCE_EVENTS) as AnnouncedFamily[]).map((family) => {
    const announced = new WeakMap<object, InjectedWallet>()

    const listener = (event: Event) => {
      const { detail } = event as CustomEvent<AnnounceDetail | undefined>
      const provider = detail?.provider
      const known = provider ? announced.get(provider) : undefined

      const wallet =
        known?.id === toAnnouncedId(family, detail) ? known : toAnnouncedWallet(family, detail)

      if (wallet && provider) {
        announced.set(provider, wallet)
        discovery.actions.announce(wallet)
      }
    }

    target.addEventListener(ANNOUNCE_EVENTS[family].announce, listener)

    return () => target.removeEventListener(ANNOUNCE_EVENTS[family].announce, listener)
  })

  for (const { request } of Object.values(ANNOUNCE_EVENTS)) {
    target.dispatchEvent(new Event(request))
  }

  detectLegacy()

  const timers = LEGACY_RECHECK_DELAYS_MS.map((delay) => setTimeout(detectLegacy, delay))
  const stopStandardWallets = watchStandardWallets(discovery)

  return () => {
    for (const stop of listeners) stop()
    for (const timer of timers) clearTimeout(timer)
    stopStandardWallets()
  }
}
