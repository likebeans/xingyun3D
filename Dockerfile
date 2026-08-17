# 星云具身驱动 Demo —— 零依赖，Node 20 即可运行
FROM node:20-alpine

WORKDIR /app

# 项目零 npm 依赖，直接复制源码
COPY package.json ./
COPY server.js ./
COPY public ./public

# 运行端口（可用环境变量覆盖）
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
