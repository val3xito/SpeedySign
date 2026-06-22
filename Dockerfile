# SpeedySign - Full Stack
# Compila zsign + ArkSigning + construye frontend Expo + servidor Node.js

# Compilar zsign-rs en Rust (jveko/zsign-rs)
FROM rust:1-bookworm AS rust-builder
WORKDIR /usr/src/zsign-rs
RUN git clone https://github.com/jveko/zsign-rs.git . \
    && cargo build --release -p zsign-cli

# ── Build del frontend ──
FROM node:20-slim AS frontend-builder

# Truco para forzar que esta etapa espere a que los signers terminen (evita problemas de concurrencia de memoria)
COPY --from=rust-builder /usr/src/zsign-rs/target/release/zsign-cli /tmp/zsign-dummy

WORKDIR /frontend
COPY package.json package-lock.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci
COPY . .

# Inyectar variables de entorno de Supabase necesarias en tiempo de compilación para Expo Web
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_ANON_KEY
ARG EXPO_PUBLIC_SIGNING_SERVER_URL
ENV EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL
ENV EXPO_PUBLIC_SUPABASE_ANON_KEY=$EXPO_PUBLIC_SUPABASE_ANON_KEY
ENV EXPO_PUBLIC_SIGNING_SERVER_URL=$EXPO_PUBLIC_SIGNING_SERVER_URL

RUN npx expo export -p web

# Copiar manifest.json al dist (Expo Metro no lo copia automáticamente)
# Necesario para que iOS 16.4+ pueda leer scope "/" y mantener el modo standalone PWA
RUN cp web/manifest.json dist/manifest.json

# ── Imagen final ──
FROM node:20-slim

# Instalar dependencias runtime (necesario para zsign y arksigning, y ClamAV)
RUN apt-get update && apt-get install -y \
    libssl3 \
    libminizip1 \
    openssl \
    zlib1g \
    clamav \
    clamav-daemon \
    && freshclam || true \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar TODAS las dependencias (incluyendo TypeScript para compilar)
COPY server/package.json server/package-lock.json ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci

# Copiar código del servidor y compilar TypeScript en tiempo de build
COPY server/ .
RUN npm run build

# Eliminar devDependencies para reducir tamaño de imagen
RUN npm prune --production

# Copiar frontend compilado
COPY --from=frontend-builder /frontend/dist /app/dist

# Copiar zsign-rs compilado
RUN mkdir -p /app/bin
COPY --from=rust-builder /usr/src/zsign-rs/target/release/zsign-cli /app/bin/zsign-rs
RUN chmod +x /app/bin/zsign-rs

# Crear directorios necesarios y ajustar permisos para el usuario 'node'
RUN mkdir -p signed temp && chown -R node:node signed temp

# Configurar y exponer puerto
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Cambiar al usuario no privilegiado 'node' para mitigar exploits/RCE
USER node

CMD ["node", "dist/index.js"]
