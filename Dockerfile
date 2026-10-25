FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY minigame/rules.js ./minigame/rules.js
ENV PORT=8080 STORE=cloud WEB_GUEST=1
ENV CLOUD_ENV=cloud1-d6g6wlodae4bf1192
# SESSION_SECRET and database credentials are injected by the service runtime.
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
