# 星云数字人互动空间 —— 零 npm 依赖
FROM node:24-bookworm-slim

WORKDIR /app

# 项目零 npm 依赖，直接复制源码
COPY package.json ./
COPY server.js ./
COPY public ./public

# 运行端口（可用环境变量覆盖）
ENV PORT=3000
EXPOSE 3000
USER node

CMD ["node", "server.js"]
