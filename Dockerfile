FROM node:24-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV MYOPC_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
