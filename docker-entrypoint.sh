#!/bin/bash
set -e

echo "[SpeedySign] 🚀 Iniciando SpeedySign..."

# ── 1. Actualizar definiciones de virus ────────────────────────────────────────
echo "[SpeedySign] 🔄 Actualizando definiciones de ClamAV (freshclam)..."
freshclam --quiet 2>/dev/null && echo "[SpeedySign] ✅ Definiciones de virus actualizadas." \
    || echo "[SpeedySign] ⚠️  freshclam falló o definiciones ya están al día. Continuando..."

# ── 2. Preparar directorio y permisos del socket de clamd ─────────────────────
mkdir -p /var/run/clamav
chown clamav:clamav /var/run/clamav
chmod 750 /var/run/clamav

# ── 3. Iniciar clamd en segundo plano (como usuario clamav) ───────────────────
echo "[SpeedySign] 🛡️  Iniciando daemon ClamAV (clamd)..."
clamd &
CLAMD_PID=$!

# ── 4. Esperar a que el socket de clamd esté disponible (máx. 60s) ────────────
echo "[SpeedySign] ⏳ Esperando que clamd esté listo..."
SOCKET_PATH="/var/run/clamav/clamd.ctl"
READY=false
for i in $(seq 1 60); do
    if [ -S "$SOCKET_PATH" ]; then
        READY=true
        break
    fi
    sleep 1
done

if [ "$READY" = true ]; then
    # Dar permisos al grupo clamav para acceder al socket (el usuario 'node' es miembro)
    chmod 660 "$SOCKET_PATH"
    echo "[SpeedySign] ✅ ClamAV daemon listo. clamdscan disponible."
else
    echo "[SpeedySign] ⚠️  ClamAV daemon no respondió a tiempo. El escaneo usará fail-open."
fi

# ── 5. Iniciar servidor Node.js como usuario 'node' (no-root) ─────────────────
echo "[SpeedySign] 🚀 Iniciando servidor Node.js como usuario 'node'..."
exec gosu node node dist/index.js
