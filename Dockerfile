FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY minigame/rules.js ./minigame/rules.js
ENV PORT=8080 STORE=cloud
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
