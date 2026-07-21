# OpenAPI documentation

Live API docs are generated at runtime by [`@spailybot/moleculer-auto-openapi`](https://github.com/spailybot/moleculer-auto-openapi).

## Endpoints

When `OPENAPI_ENABLED=true` (default in development/dockerdev):

- Swagger UI: `GET /openapi/ui`
- OpenAPI JSON: `GET /openapi/openapi.json`

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

## Notable gaps vs SwaggerHub

- Raw Stripe webhook: `POST /apis/v1/order/payment/webhook-raw/{supplier}` (documented in generated spec)
- `POST /subscription/reactivate/{subscriptionId}` — routed but not implemented (marked deprecated)
- Stripe subscription prepare responses include `clientSecret` and `paymentStatus`
