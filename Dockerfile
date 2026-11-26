# Imagen para publicar la demo (Render, Railway, Fly.io o cualquier host con Docker)
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
EXPOSE 3001
# Cada arranque recrea la base con los datos de prueba (es una demo)
CMD ["bun", "run", "start"]
