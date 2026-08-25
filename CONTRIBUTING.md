# Contributing to StretchShop

Thanks for helping improve StretchShop. This repository is the **backend** (Moleculer REST API). The Vue SPA lives in a separate repo: [stretchshop-front-vue](https://github.com/StretchShop/stretchshop-front-vue).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately using [SECURITY.md](SECURITY.md) — do not open public GitHub issues for vulnerabilities.

## Ways to help

- Fix bugs and add tests (see [Automated testing](https://github.com/StretchShop/StretchShop/wiki/Automated-testing)).
- Improve documentation in this repo or the [wiki](https://github.com/StretchShop/StretchShop/wiki).
- Run the [manual QA checklist](https://github.com/StretchShop/StretchShop/wiki/Test-scenarios) on https://demo.stretchshop.app or a local instance.
- Share StretchShop and help shops that need more control than a hosted builder.

More ideas: [How to train our StretchShop](https://github.com/StretchShop/StretchShop/wiki/How-to-train-our-StretchShop).

## Prerequisites

- **Node.js 22.23+** (see `engines` in `package.json`; Docker images use Node 22 Alpine)
- **npm** (lockfile is `package-lock.json`)
- **MongoDB 7** on `mongodb://localhost:27017` (or set `MONGO_URI`)

Optional: Docker for the compose stacks under `docker/`.

## Local setup

```bash
git clone https://github.com/StretchShop/StretchShop.git
cd StretchShop
cp .env.example .env
```

Edit `.env`. For local development you can keep `NODE_ENV` as `development` or `test`. Generate real secrets before any production-like run:

```bash
openssl rand -hex 32   # use once for JWT_SECRET and once for COOKIES_KEY
```

Install dependencies. A normal `npm install` runs `demo/demo.js` via `postinstall` and loads demo data into MongoDB.

```bash
npm install          # installs deps + demo data
# or, to skip demo data (CI does this):
npm ci --ignore-scripts
```

Start the API (all services in one process, Moleculer REPL):

```bash
npm run dev
```

The gateway listens on **http://localhost:3000**. Compiled SPA files in `public/` are served from the same origin. For frontend source and hot reload, clone `stretchshop-front-vue` (typically port **8080**) and set `CORS_ORIGIN` if the UI is on another origin. See the [Frontend](https://github.com/StretchShop/StretchShop/wiki/Frontend) wiki page.

## Tests and lint

CI (`.github/workflows/ci.yml`) runs on push to `main`/`master` and on pull requests: Node 22, MongoDB 7, `npm run lint`, then `npm test`.

```bash
npm run lint         # ESLint on services/
npm test             # Jest with coverage (test/unit/**/*.spec.js)
```

`npm test` collects coverage from `services/` and `mixins/` and **fails if global statements or lines drop below 60%**. Keep the threshold green when you change production code — add or extend specs under `test/unit/`.

MongoDB should be running. Jest sets `NODE_ENV=test` and dummy JWT/Stripe values in `test/setup/jest.setup.js` if they are missing.

Do not commit `coverage/` output.

## Coding conventions

- JavaScript (CommonJS). Tabs, double quotes, semicolons (`eslint.config.js`).
- Business logic belongs in Moleculer **services** (`services/<name>/`). Shared helpers go in **mixins**.
- HTTP routes are declared in `resources/routes/apiV1.js` (`mappingPolicy: "restrict"`).
- Do not put secrets in git. `.env` is ignored; `.env.example` and `docker/*/docker-compose.env` must stay free of real credentials.
- Production rejects missing or well-known placeholder values for `JWT_SECRET` and `COOKIES_KEY`.

## Pull requests

1. Open an [issue](https://github.com/StretchShop/StretchShop/issues) for larger changes when you can, so the approach can be discussed first.
2. Branch from the default branch. Keep the diff focused.
3. Add or update unit tests for the behavior you change.
4. Run `npm run lint` and `npm test` locally.
5. Describe **why** the change exists. Link related issues and wiki pages if docs should move with the code.
6. Do not include exploit PoCs, credentials, or customer data.

License of contributions is [GPL-3.0](LICENSE), same as the project.

## Documentation

| Place | What belongs there |
|-------|--------------------|
| [Wiki](https://github.com/StretchShop/StretchShop/wiki) | Install, architecture, services, setup, contribute |
| `README.md` | Project intro and pointers |
| `docs/openapi/` | Live OpenAPI generation and SwaggerHub sync |
| `services/orders/README.order-statuses.md` | Order / product / subscription status values |
| This file | How to develop and send changes |

Wiki source is the GitHub wiki repo (`StretchShop.wiki.git`). Page files are grouped under `pages/` in a local clone; GitHub wiki URLs use the page title (for example `Installation.md` → `/wiki/Installation`).

## Related

- [Wiki: Contributing](https://github.com/StretchShop/StretchShop/wiki/Contributing)
- [Wiki: Automated testing](https://github.com/StretchShop/StretchShop/wiki/Automated-testing)
- [OpenAPI in this repo](docs/openapi/README.md)
- Frontend: https://github.com/StretchShop/stretchshop-front-vue
