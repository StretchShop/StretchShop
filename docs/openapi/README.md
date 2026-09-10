# OpenAPI documentation

Live API docs are generated at runtime by [`@spailybot/moleculer-auto-openapi`](https://github.com/spailybot/moleculer-auto-openapi).

## Endpoints

Live docs are **off in production** unless you set `OPENAPI_ENABLED=true`. They are on in `development` / `dockerdev` / `test`, when `OPENAPI_ENABLED=true`, or when `SITE_URL` points at `demo.stretchshop.app`:

- Swagger UI: `GET /openapi/ui`
- OpenAPI JSON: `GET /openapi/openapi.json`

`GET /openapi/ui?url=` is restricted to the local schema path (`/openapi/openapi.json`). Other values (including HTML or `javascript:` payloads) return `400`. Spec URL is HTML-encoded before it is written into the page so `</script>` cannot break out of the settings block.

In Docker **micro** / **mixed** layouts, production compose files do not load the `openapi` service. If you opt in with `OPENAPI_ENABLED=true`, add `openapi` to the API container `SERVICES` as well — env alone is not enough and the gateway returns `503 ServiceUnavailableError`.

## Source of truth

| Layer | Source |
|-------|--------|
| Routes & request params | [`resources/routes/apiV1.js`](../resources/routes/apiV1.js) + action `params` |
| Shared schemas & tags | [`swaggerhub-components.json`](swaggerhub-components.json) (from [SwaggerHub](https://app.swaggerhub.com/apis/marcelzubrik/StretchShop_API/1.0.0-oas3)) |
| Per-action summaries/responses | [`action-openapi.js`](action-openapi.js) |

## Maintenance

```bash
# Refresh components + action metadata from SwaggerHub
npm run openapi:build

# Export generated spec for drift check
npm run openapi:export
```

Save a SwaggerHub export as `docs/openapi/swaggerhub-export.json` to compare path coverage when running `openapi:export`.

## Auth in docs

- `CookieAuth` — JWT `token` cookie (logged-in routes)
- `CsrfHeader` — `x-xsrf-token` header (login, register, email/username checks)

Guest checkout uses a separate HttpOnly cookie `order_no_verif` (JWT scoped to the order). It is not the same as the user `token` cookie. See the [API](https://github.com/StretchShop/StretchShop/wiki/API) wiki page.

## Notable gaps vs SwaggerHub

- Raw Stripe webhook: `POST /apis/v1/order/payment/webhook-raw/{supplier}` (documented in generated spec)
- Stripe subscription prepare responses include `clientSecret` and `paymentStatus`
