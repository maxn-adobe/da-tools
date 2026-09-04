// Product types the GMC backend (pdp-gmc-sync) can resolve a `google_product_category` for.
//
// MIRROR of pdp-gmc-sync `config/category-map.json` keys. The backend hard-rejects any row whose
// `product_type` has no entry there (actions/lib/validate.js → resolveGoogleProductCategory). Keep
// this set in sync whenever a product_type is added to / removed from that file — the same
// mirror-the-backend-contract pattern used by GmcSyncRow and sanitizeOfferId. Used to flag unmapped
// types in the submit dialog BEFORE submitting, instead of discovering the rejection mid-batch.
export const GMC_MAPPED_PRODUCT_TYPES: ReadonlySet<string> = new Set([
  'zazzle_shirt',
  'zazzle_businesscard',
  'zazzle_mug',
  'zazzle_bag',
  'mojo_throwpillow',
  'zazzle_foldedthankyoucard',
  'zazzle_invitation3',
  'zazzle_print',
  'zazzle_sticker',
  'zazzle_flyer',
]);

/** Reason shown on a row excluded from GMC submit because its product type has no category mapping. */
export function unmappedCategoryReason(productType: string): string {
  return `Product type "${productType}" isn't mapped to a Google category — add it to the GMC category map before submitting`;
}
