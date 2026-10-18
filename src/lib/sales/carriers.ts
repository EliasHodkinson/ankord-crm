/**
 * Couriers a supplier ships with, and how each one's tracking page is built
 * from a consignment number. Client-safe: the shipment form previews the link
 * as it is typed, and the server builds the same one when it saves.
 *
 * The links are the carriers' public tracking pages. A carrier that changes
 * its URL only breaks the link, never the record: the number is kept, and an
 * "Other" shipment carries whatever URL was typed.
 */

export type CarrierKey =
  | "auspost"
  | "startrack"
  | "tnt"
  | "couriersplease"
  | "aramex"
  | "dhl"
  | "toll"
  | "sendle"
  | "other";

type Carrier = { label: string; url: ((number: string) => string) | null };

const enc = encodeURIComponent;

export const CARRIERS: Record<CarrierKey, Carrier> = {
  auspost: { label: "Australia Post", url: (n) => `https://auspost.com.au/mypost/track/details/${enc(n)}` },
  startrack: { label: "StarTrack", url: (n) => `https://startrack.com.au/track/details/${enc(n)}` },
  tnt: {
    label: "TNT",
    url: (n) => `https://www.tnt.com/express/en_au/site/shipping-tools/tracking.html?searchType=con&cons=${enc(n)}`,
  },
  couriersplease: { label: "CouriersPlease", url: (n) => `https://www.couriersplease.com.au/tools-track/no/${enc(n)}` },
  aramex: { label: "Aramex", url: (n) => `https://www.aramex.com.au/tools/track?l=${enc(n)}` },
  dhl: {
    label: "DHL",
    url: (n) => `https://www.dhl.com/au-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc(n)}`,
  },
  toll: { label: "Toll", url: (n) => `https://www.mytoll.com/?externalSearchQuery=${enc(n)}` },
  sendle: { label: "Sendle", url: (n) => `https://track.sendle.com/tracking?ref=${enc(n)}` },
  other: { label: "Other", url: null },
};

export const CARRIER_KEYS = Object.keys(CARRIERS) as CarrierKey[];

export const isCarrier = (value: string): value is CarrierKey => value in CARRIERS;

export function carrierLabel(key: string): string {
  return isCarrier(key) ? CARRIERS[key].label : key;
}

/**
 * The tracking link for a shipment: the carrier's page for that number, or
 * for "Other" the URL that was typed, if it is a web address at all.
 */
export function trackingUrl(carrier: string, number: string | null, typed?: string | null): string | null {
  const consignment = number?.replace(/\s+/g, "").trim();
  if (isCarrier(carrier) && CARRIERS[carrier].url && consignment) return CARRIERS[carrier].url!(consignment);
  const url = typed?.trim();
  if (url && /^https?:\/\/[^\s]+$/i.test(url)) return url;
  return null;
}
