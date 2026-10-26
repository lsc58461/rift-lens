FROM node:24.22.1-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.mjs ./

USER node
CMD ["node", "index.mjs"]
