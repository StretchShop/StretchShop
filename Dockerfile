# node:current-alpine
FROM node:22-alpine

RUN mkdir /app
WORKDIR /app

ENV NODE_ENV=production

COPY package.json .

RUN npm install --silent --progress=false --production --ignore-scripts

COPY . .

CMD ["npm", "start"]
