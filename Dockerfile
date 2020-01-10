FROM node:10-alpine

RUN mkdir /app
WORKDIR /app

ENV NODE_ENV=production

COPY package.json .

RUN npm install --silent --progress=false --production

COPY . .

CMD ["npm", "start"]
