FROM node:22.23.1-alpine AS base
RUN npm install -g npm@12.0.1

FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

FROM base AS production

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S stretchshop && adduser -S stretchshop -G stretchshop

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json moleculer.config.js ./
COPY mixins ./mixins
COPY services ./services
COPY docs/openapi ./docs/openapi

# Seed demo assets (public media, navigation, pages, emails), then overlay
# repo files so tracked runtime data (pdf fonts, templates) always wins.
RUN apk add --no-cache git \
	&& git clone --depth 1 https://github.com/StretchShop/StretchShop-demo-data.git /tmp/demo-data \
	&& mkdir -p resources public \
	&& cp -a /tmp/demo-data/resources/. ./resources/ \
	&& cp -a /tmp/demo-data/public/. ./public/ \
	&& rm -rf /tmp/demo-data \
	&& apk del git

COPY resources /tmp/repo-resources
COPY public /tmp/repo-public
RUN cp -a /tmp/repo-resources/. ./resources/ \
	&& cp -a /tmp/repo-public/. ./public/ \
	&& rm -rf /tmp/repo-resources /tmp/repo-public \
	&& test -f resources/pdftemplates/fonts/pdfmake-font-definition.js \
	&& test -f resources/pdftemplates/fonts/Roboto-Regular.ttf \
	&& test -f resources/pdftemplates/fonts/Roboto-Medium.ttf \
	&& test -f resources/pdftemplates/fonts/Roboto-Italic.ttf \
	&& test -f resources/pdftemplates/fonts/Roboto-MediumItalic.ttf \
	&& test -f resources/navigation/navigation-main.json \
	&& test -f resources/pages/_default/default/default.html \
	&& test -d public/assets/data

RUN chown -R stretchshop:stretchshop /app

USER stretchshop

EXPOSE 3000

CMD ["npm", "start"]
