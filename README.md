![](public/assets/_site/StretchShop-1800-whitebg.png)

# StretchShop

StretchShop is an open-source e-commerce **REST API** (with a compiled Vue SPA in `public/`). It is built for shops that want control over design, catalog, checkout, and deployment — without starting from a blank framework.

It runs on Node.js and the [Moleculer](https://moleculer.services/) microservices framework, so the same codebase can run as a **monolith** or as **split services** (Docker compose layouts under `docker/`).

- Site: https://stretchshop.app/
- Live demo (microservices): https://demo.stretchshop.app/
- **Wiki:** https://github.com/StretchShop/StretchShop/wiki
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)

License: [GPL-3.0](LICENSE). Current package version: **0.7.5**. Requires **Node.js 22.23+**.

# Quick start

Three install paths — pick the one that matches how you want to work:

1. [npm](https://github.com/StretchShop/StretchShop/wiki/Installation#npm) — **your own project**. Fastest way to get a development shop with demo data.
2. [Docker](https://github.com/StretchShop/StretchShop/wiki/Installation#docker) — **compose stacks** (monolith, micro, or mixed) for a containerized demo or production-shaped layout.
3. [Git](https://github.com/StretchShop/StretchShop/wiki/Installation#git) — **this repository**, for contributors and anyone who wants the source.

```bash
git clone https://github.com/StretchShop/StretchShop.git
cd StretchShop
cp .env.example .env
npm install          # also loads demo data (postinstall)
npm run dev          # http://localhost:3000
```

MongoDB 7 must be running (`MONGO_URI`, default `mongodb://localhost:27017/stretchshop_demo`).

# Learn more

| Topic | Where |
|-------|--------|
| Install, architecture, services, setup | [StretchShop Wiki](https://github.com/StretchShop/StretchShop/wiki) |
| Environment variables | [Environment setup](https://github.com/StretchShop/StretchShop/wiki/Environment-setup) and [`.env.example`](.env.example) |
| Live OpenAPI (when enabled) | `/openapi/ui` — see [docs/openapi](docs/openapi/README.md) |
| Order status values | [services/orders/README.order-statuses.md](services/orders/README.order-statuses.md) |
| Tests, lint, pull requests | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Vulnerabilities | [SECURITY.md](SECURITY.md) |

The Vue source is **not** in this repo. Customize UI in [stretchshop-front-vue](https://github.com/StretchShop/stretchshop-front-vue) and copy the production build into `public/app/`.
