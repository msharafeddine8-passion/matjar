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

/** The lowest price a customer can book this service at — the «من $X» line. */
export function lowestOptionPrice(basePrice: number, options: ServiceOption[] | undefined): number {
  if (!options || options.length === 0) return basePrice;
  return Math.min(...options.map((o) => o.price ?? basePrice));
}
