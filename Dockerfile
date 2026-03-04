FROM node:25-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=1310

EXPOSE 1310

CMD ["sh", "-c", "node bin/social.js --no-banner gateway --host 0.0.0.0 --port ${PORT:-1310} --require-api-key"]