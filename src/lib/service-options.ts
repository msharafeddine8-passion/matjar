// A service with several prices (0321). The rows are product_variants of a
// service product: a label, its own price and optionally its own duration.
// place_booking applies the same rule as the helpers below — the option's
// price else the service's, the option's duration else the service's.

export type ServiceOption = {
  id: string;
  label: string;
  /** null = the service's price */
  price: number | null;
  /** null = the service's duration */
  durationMinutes: number | null;
};

/**
 * The price line beside a service. One price: that price. Several (options):
 * every distinct price, low to high — «$5 · $10 · $15» — so the customer sees
 * the real choices without opening anything; past MAX_LISTED it falls back to
 * «من $X», because a row of seven prices is no longer read.
 */
export const MAX_LISTED_PRICES = 4;

export function servicePriceLine(
  basePrice: number,
  options: ServiceOption[] | undefined,
  format: (n: number) => string,
  fromTemplate: string,
): string {
  if (!options || options.length === 0) return format(basePrice);
  const prices = [...new Set(options.map((o) => o.price ?? basePrice))].sort((a, b) => a - b);
  if (prices.length === 1) return format(prices[0]);
  if (prices.length > MAX_LISTED_PRICES) {
    return fromTemplate.replace("{price}", format(prices[0]));
  }
  return prices.map(format).join(" · ");
}

/** The lowest price a customer can book this service at — the «من $X» line. */
export function lowestOptionPrice(basePrice: number, options: ServiceOption[] | undefined): number {
  if (!options || options.length === 0) return basePrice;
  return Math.min(...options.map((o) => o.price ?? basePrice));
}
