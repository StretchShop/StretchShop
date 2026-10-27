# Bank transfer QR codes

`bank-transfer-qr.js` builds the payment QR stored on a bank-transfer order and printed on the invoice. Slovak and Czech shops use PAY by square. Every other shop country uses an EPC SEPA credit-transfer QR (EPC069-12, version 002).

The shop account comes from `resources/settings/business.json` at `invoiceData.company.bankAccount`. All four fields are required before a QR can be built: `iban`, `name`, `bankName`, `bankCode`. Amount, currency, variable symbol, and the payment note come from the order, not from that account object.

`getSiteSettings("business")` caches the file for the life of the process. A change to `business.json` is invisible until the server restarts.

## What goes into the code

| Field | Source |
| --- | --- |
| Account holder | `bankAccount.name`, diacritics removed, max 70 characters |
| Bank name | `bankAccount.bankName`, diacritics removed. Stored on the order for the customer. It is not a PAY by square or EPC field. |
| IBAN | Spaces removed, uppercased |
| BIC | `bankAccount.bankCode` only when it matches ISO 9362 (8 or 11 characters). A local numeric bank code is omitted. An 8-character BIC is valid; do not pad it. |
| Amount | `prices.priceTotalToPay`, otherwise `priceTotal` minus `data.paymentData.paidAmountTotal` |
| Currency | `prices.currency`, default `EUR` |
| Variable symbol | 10 digits derived from `order._id`. Not stored on the order. See below. |
| Payment note | Order id, customer email, shop name. Max 140 characters. See below. |

Diacritics are stripped before a value is stored or encoded. Letters that do not decompose under NFD (`ľ`, `ĺ`, `ł`, `đ`, `ø`, and the ligatures in `ASCII_LETTERS`) are mapped first.

### Payment note

Three space-separated parts, in this order. The order id is required. Email and shop name are dropped when they do not fit, then the string is cut at 140 characters.

1. Order id shown to the customer: `externalCode`, then `_id`, then `id`, then `invoice.id`. Punctuation is removed, so `OBJ-77` becomes `OBJ77`.
2. Customer email: `order.user.email`, then the invoice address. `@` is written as `(at)`. `.`, `_`, `+`, and `-` stay.
3. Shop name: `SITE_NAME`, then `invoiceData.company.name`.

Text parts keep letters, digits, and spaces. `Môj obchod, s.r.o.` becomes `Moj obchod sro`.

### Variable symbol

PAY by square only. SHA-256 of the order id string, first 8 digest bytes modulo 10^10, zero-padded to 10 digits. A 24-character hex ObjectId is lowercased first, so letter case does not change the symbol.

`variableSymbolMatchesOrderId` accepts 1 to 10 digits because some bank apps drop leading zeros. The symbol is never taken from the invoice number or another free-text reference. It is not a property of the order model.

## PAY by square

Encoded with `bysquare` (`bysquare/pay`). The call is `encode({ payments: [model] }, options)`. The `payments` array is the library's document. One payment is a list of one item. The library then writes a count of `1` and that single payment. Passing the payment object by itself throws `model.payments is not iterable`.

Options passed on every encode:

- `version: 0x00` (see the header finding below)
- `deburr: true`
- `validate: true`

Passing `{ version }` alone turns deburr and validate off. The options object has to include all three.

The QR error correction level is **L**. The PAY by square specification requires L. EPC uses **M**.

Beneficiary name is included. The specification appends it after the payment block so older readers can ignore it. The header version stays 0 either way.

### Header version must stay 0

This is the check that made Fio and mBank reject otherwise valid codes.

The Base32hex text inside the QR starts with four characters that encode a 16-bit header: type, version, document type, reserved (4 bits each). PAY by square is type `0`, document type `0`, reserved `0`.

Specification documents 1.0.0 (2013), 1.1.0 (2015), and 1.2.0 (2025) all say the **PAY by square type version is 0** (Table 4). The 2015 and 2025 documents added beneficiary fields and then made the name required, but they did not raise the version nibble. Section 3.16 says a decoder must stop with an unknown-document error when that nibble is higher than the version the app knows.

The `bysquare` package maps its own document history onto that nibble:

| Library option | Header nibble | Base32hex prefix | Bank apps |
| --- | --- | --- | --- |
| `0x00` (`1.0.0`) | 0 | `00` | Accepted |
| `0x01` (`1.1.0`) | 1 | `04` | Rejected as an unsupported BySquare version |
| `0x02` (`1.2.0`, library default) | 2 | `08` | Rejected the same way |

`PAY_BY_SQUARE_VERSION` is `0x00` for that reason. Do not switch it to the library default, and do not set it to `1` because a document is titled "1.1.0". Those numbers are the specification document, not the header.

A generated PAY by square string that does not start with `00` is the wrong header.

## EPC

Used when the shop country is not Slovakia or Czechia. Twelve lines separated by LF:

`BCD`, `002`, charset `1` (UTF-8), `SCT`, BIC, beneficiary name (70), IBAN, `EUR#.##` or empty, empty purpose, empty structured remittance, unstructured remittance (140), beneficiary-to-originator text (70).

The payment note is written to both the 140-character remittance and the 70-character text shown to the payer. Structured remittance stays empty because it is mutually exclusive with the unstructured note.

The SEPA character set is `A–Z a–z 0–9 space / - ? : ( ) . , ' +`. There is no `@` and no `_`. `@` is rewritten to `(at)` and `_` to `-` before the rest is stripped. One character outside that set is enough for an app to drop the whole note while still filling IBAN and amount.

Error correction is **M**.

mBank's Slovak app reads PAY by square and does not accept an EPC code. Fio accepts both.

## Development preview

`GET /api/v1/dev/bank-transfer-qr/:orderId` returns the SVG. `NODE_ENV` must be `development` or `dockerdev`. Any other environment answers 404 before the order is loaded. A missing order is 404. An incomplete bank account is 422. The route does not log in and does not save the QR.

`npm run dev` does not hot-reload this module. Restart the process after changing the generator or `business.json`.
