# 依赖阶段：better-sqlite3 需要本地编译工具；这些工具不进入运行镜像。
# DEBIAN_MIRROR 便于按构建环境选择更快的软件源。
FROM node:24-bookworm-slim AS deps
ARG DEBIAN_MIRROR=deb.debian.org
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g; s|security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --include=dev

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV MYOPC_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
