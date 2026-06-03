# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS production

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
