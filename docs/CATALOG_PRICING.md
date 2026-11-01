# Catalog pricing and November product photos

In **Dashboard → Catalog**, staff can set shared markup and insurance percentages.
For products using **Cost + markup + insurance**, edit the cost in the product form.
The server calculates:

```
selling = cost × (1 + markup / 100)
insurance = selling × insurance / 100
product total = selling + insurance
```

The workbook defaults are 10% markup and 1% insurance. BUA costs ₦57,700 and
therefore totals ₦64,104.70. Calculations use integer kobo and round the final
charge to the nearest kobo. Insurance is included in the product price; existing
delivery, service and repayment-plan charges are separate.

Saving shared percentages recalculates all percentage-priced products in one
transaction. Product cost edits and imports use the same configuration lock.
Existing manual prices stay manual until staff select percentage pricing.
Manual discounts can be cleared; percentage pricing has no separate discount.
Existing orders retain the prices recorded at purchase. Saved web carts refresh
prices and checkout rejects a stale confirmed subtotal instead of silently
charging a changed product price.

## Product import

Expand **November price list — preview & import 21 products** to review source
costs, calculated totals, image matches and sale-unit notes. **Add price-list
products as drafts** creates the 21 rows with stable SKUs `PL-2026-07` through
`PL-2026-27`, zero opening stock and the currently saved percentages. Import is
atomic and idempotent; repeated imports skip those SKUs and preserve staff edits.
It does not overwrite unrelated existing products or infer physical stock.

Costs and expected default totals are transcribed from
`Price_List_Markup_Insurance-1.xlsx`, worksheet `Price List`, rows 7–27. The 21
default totals sum to ₦805,752.75. The original workbook is unchanged.

Six images match: BUA, Jaaf, Optimum and Zyn rice 50kg; Indomie Hungry Man carton;
Star Oil 10L. Other rows use a neutral placeholder and review notes. In
particular, Semovita is not the photographed Supreme Semolina, Gino Sachet does
not identify Party Jollof seasoning, Power Oil costs do not specify carton counts,
and “Pack of 5 L” does not specify bottle count. Verify these before publishing.

All 13 supplied studio PNGs are in `apps/web/public/catalog/studio`. Select them
from **Choose from 13 studio images** in a product form. Emperor, Star 25L,
Supreme Semolina and Zyn oil have no unambiguous matching costs in the workbook;
use their images when creating the correct product with a confirmed cost. Group
photos stay group photos. Regenerated label fine print needs review against
physical packaging before publication.

## Online selling prices for additional photographed products

The **Additional studio products — online selling prices** panel offers four
additional manual-price drafts, with source links and a 1 November 2026 check
date. Retail prices are not treated as supplier costs and do not receive the
workbook's markup and insurance a second time. Staff can edit the selling price
or enter a confirmed cost and switch to percentage pricing later.

| Product | Listed retail price | Source |
| --- | ---: | --- |
| Supreme Semolina 10kg | ₦18,000 | [OjaOba](https://shop.ojaoba.com/products/supreme-semolina-10kg) |
| Gino Party Jollof 50g carton | ₦11,000 | [OjaOba](https://shop.ojaoba.com/products/gino-party-jollof-50g-carton) |
| Splendor Star Oil 25L | ₦66,000 | [Solemn Shopping](https://www.solemn.com.ng/product/splendor-star-vegetable-oil) |
| Emperor Oil 25L | ₦85,000 | [CBN Cooperative Mall](https://mall.thecbncoop.com/product/4410/emperor-vegetable-oil-25litre) |

Gino's photographed carton states 50 × 50g; the retail source says “50g Carton,”
so confirm the count before publishing. Zyn oil stays pending: the located
[Iyknel listings](https://www.iyknel.biz/products?category=oil) price other
pack sizes, not the photographed single jerrycan. No per-litre extrapolation
or unverified cost has been substituted. Online prices exclude retailer shipping
and can change. Re-imports preserve staff edits.

## Activation

Deploy the API and web changes together and apply database migration 0030 through
the normal release process. It adds `products.pricing_mode`, validation constraints
and the `catalog_pricing` configuration with workbook defaults. Then import the
price list from the dashboard, review product details, record actual stock through
Inventory, and publish products. This code change does not apply migrations to
the live database or publish products automatically.

Admin endpoints (existing admin/super_admin guards apply):

- `GET/PATCH /v1/admin/catalog/pricing`
- `GET /v1/admin/catalog/price-list`
- `POST /v1/admin/catalog/price-list/import` with the web app's `imageBaseUrl`
- `GET /v1/admin/catalog/market-prices`
- `POST /v1/admin/catalog/market-prices/import` with the web app's `imageBaseUrl`

Public product responses expose the final selling price, not supplier costs.
