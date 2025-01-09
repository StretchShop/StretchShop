# node:current-alpine
FROM node:23-alpine

RUN mkdir /app
WORKDIR /app

ENV NODE_ENV=production

COPY package.json .

RUN npm install -g npm@latest

RUN npm install --silent --progress=false --production --ignore-scripts

COPY . .

CMD ["npm", "start"]
