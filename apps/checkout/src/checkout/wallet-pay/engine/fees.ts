import { fromBaseUnits, trimTrailingZeros } from "@bitcart/core/utils"

const FEE_DIGITS = 2

const roundUpSignificant = (units: bigint, digits: number): bigint => {
  const factor = 10n ** BigInt(Math.max(0, units.toString().length - digits))

  return ((units + factor - 1n) / factor) * factor
}

//* A fee shown to the customer: rounded up to two significant digits, so topping up by it still
//* covers a slightly higher fee.
export const formatFee = (units: bigint, decimals: number): string =>
  trimTrailingZeros(fromBaseUnits(roundUpSignificant(units, FEE_DIGITS), decimals))
