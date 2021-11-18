FROM node:lts-alpine

RUN mkdir /app
WORKDIR /app

ENV NODE_ENV=production

COPY package.json .

RUN npm install npm@latest

RUN npm install --silent --progress=false --production --ignore-scripts

COPY . .

CMD ["npm", "start"]
