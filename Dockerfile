FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY minigame/rules.js ./minigame/rules.js
ENV PORT=8080 STORE=cloud
# 临时注入（CLI --env-params 在此版本无效，故先写进镜像跑通）：CLOUD_ENV 非密钥；
# SESSION_SECRET 必须与 cloud1 的 login 云函数一致（64位）。验证跑通后须移入云托管控制台环境变量并从此处删除。
ENV CLOUD_ENV=cloud1-d6g6wlodae4bf1192 SESSION_SECRET=38b620ae74df21510b9457b4b89a8e0dd432376435b0ca9afe8a89cfaf567c09
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
