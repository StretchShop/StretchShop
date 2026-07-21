# syntax=docker/dockerfile:1

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
COPY resources ./resources
COPY public ./public

RUN chown -R stretchshop:stretchshop /app

USER stretchshop

EXPOSE 3000

CMD ["npm", "start"]
