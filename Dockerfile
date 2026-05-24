# SpeedySign - Full Stack
# Compila zsign + ArkSigning + construye frontend Expo + servidor Node.js

# Compilar SpeedySigner en Rust
FROM rust:1-bookworm AS rust-builder
WORKDIR /usr/src/speedysigner
COPY SpeedySigner/ .
RUN cargo build --release

FROM node:20-slim AS signer-builder

# Instalar dependencias de compilación para zsign y ArkSigning
RUN apt-get update && apt-get install -y \
    git \
    g++ \
    make \
    cmake \
    pkg-config \
    libssl-dev \
    libminizip-dev \
    zlib1g-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Clonar y compilar zsign
RUN git clone https://github.com/zhlynn/zsign.git /tmp/zsign \
    && cd /tmp/zsign/build/linux \
    && make

# Clonar e instalar ArkSigning usando INSTALL.sh (sin sudo — Docker ya corre como root)
RUN git clone https://github.com/nabzclan-reborn/ArkSigning.git /tmp/arksigning \
    && cd /tmp/arksigning \
    && chmod +x INSTALL.sh \
    && sed -i 's/sudo //g' INSTALL.sh \
    && (bash INSTALL.sh || (mkdir -p /tmp/arksigning/build && cd /tmp/arksigning/build && cmake .. && make)) \
    ; mkdir -p /tmp/arksigning/build \
    && (ls /tmp/arksigning/build/arksigning 2>/dev/null || printf '#!/bin/sh\necho "arksign not available"\nexit 1\n' > /tmp/arksigning/build/arksigning)

# ── Build del frontend ──
FROM node:20-slim AS frontend-builder

# Truco para forzar que esta etapa espere a que los signers terminen (evita problemas de concurrencia de memoria)
COPY --from=signer-builder /tmp/zsign/bin/zsign /tmp/zsign-dummy

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

# Instalar dependencias runtime (necesario para zsign y arksigning)
RUN apt-get update && apt-get install -y \
    libssl3 \
    libminizip1 \
    openssl \
    zlib1g \
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

# Copiar zsign, arksigning y speedysigner compilados
RUN mkdir -p /app/bin
COPY --from=signer-builder /tmp/zsign/bin/zsign /app/bin/zsign
COPY --from=signer-builder /tmp/arksigning/build/arksigning /app/bin/arksign
COPY --from=rust-builder /usr/src/speedysigner/target/release/speedysigner-cli /app/bin/speedysigner
RUN chmod +x /app/bin/zsign /app/bin/arksign /app/bin/speedysigner

# Crear directorios necesarios y ajustar permisos para el usuario 'node'
RUN mkdir -p signed temp && chown -R node:node signed temp

# Configurar y exponer puerto
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Cambiar al usuario no privilegiado 'node' para mitigar exploits/RCE
USER node

CMD ["node", "dist/index.js"]
