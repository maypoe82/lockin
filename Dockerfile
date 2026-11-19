# ---- LockIn production image ----
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install deps first so Docker caches this layer between code changes
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Don't run as root
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "app.js"]
