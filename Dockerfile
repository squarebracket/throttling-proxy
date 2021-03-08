FROM alpine:latest

EXPOSE 3000

RUN apk add --no-cache git nodejs npm

WORKDIR /app

ADD index.js package.json package-lock.json ./

RUN npm ci

ENV NODE_EXTRA_CA_CERTS=/extra-ca-certs.pem

CMD ["npm", "start"]
