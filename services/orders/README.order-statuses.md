# Order statuses

`order.status` is a free-form string (min length 3). There is a canonical list in `constants/order.constants.js`, but the code also writes several other values onto the order document.

These lists do not fully overlap. Treat this file as the combined reference.

## Canonical list (`orderStatuses`)

Defined in `constants/order.constants.js`. Used by `getOrderPaymentStatus()` as a computed payment summary.

| Index | Value | Meaning |
| ---: | --- | --- |
| 0 | `saved` | Stored, not prepared for the payment gateway |
| 1 | `prepared` | Prepared for the payment gateway |
| 2 | `paid` | Paid; products shipping or subscriptions running |
| 3 | `finished` | All products delivered, all subscriptions completed |
| 4 | `stopped` | Paused or canceled |
| 5 | `failed` | Failed |

## Values written to `order.status`

| Value | When |
| --- | --- |
| `cart` | New/empty checkout order (`createEmptyOrder`) |
| `saved` | Checkout succeeded (`getOrderProgressAction`) |
| `sent` | Order accepted by the external sender (`orderAfterSaveActions`) |
| `paid` | Payment received, or admin marks paid |
| `expeded` | Admin marks shipped (spelling of “expedited”) |
| `canceled` | User or admin cancels |
| `trial` | Admin marks a subscription order as trial |

`prepared`, `finished`, `stopped`, and `failed` come from the canonical list and may appear as a computed payment summary. They are not currently assigned with `order.status = …` in the same way as the values above.

## Full set on an order

`cart`, `saved`, `sent`, `prepared`, `paid`, `expeded`, `finished`, `stopped`, `failed`, `canceled`, `trial`

## Related filters and checks

- Admin order lists filter on `saved`, `sent`, `paid`, and `expeded`.
- After an order update, confirmation email / cart-clear is skipped when the order is already accepted: `saved`, `sent`, `paid`, `expeded`, `prepared`, `finished` (or `dates.emailSent` is set).
- Stale carts (`status: "cart"` unchanged for a month) are removed by `cleanOrders`.

## Related status lists (not `order.status`)

Nested product and subscription payment statuses are separate and must not be confused with `order.status`.

### Product statuses (`productStatuses`)

Defined in `constants/product.constants.js`.

| Index | Value | Meaning |
| ---: | --- | --- |
| 0 | `saved` | Created, not prepared for the payment gateway |
| 1 | `prepared` | Prepared for the payment gateway |
| 2 | `paid` | Paid, prepared for shipping |
| 3 | `shipped` | Shipped |
| 4 | `delivered` | Delivered |
| 5 | `canceled` | Canceled |
| 6 | `failed` | Failed |

### Subscription payment statuses (`subscriptionPaymentStatuses`)

Defined in `constants/subscription.constants.js`.

| Index | Value | Meaning |
| ---: | --- | --- |
| 0 | `saved` | Created, not prepared for the payment gateway |
| 1 | `prepared` | Prepared for the payment gateway |
| 2 | `trialing` | Trial period |
| 3 | `active` | Active |
| 4 | `completed` | Completed and finished |
| 5 | `paused` | Paused |
| 6 | `canceled` | Canceled |
| 7 | `failed` | Payment failed |
