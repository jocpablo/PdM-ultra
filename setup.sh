#!/bin/bash
# ============================================================
#  SUITE PdM - Script de instalación (Linux / macOS)
#  Uso: bash setup.sh
# ============================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Suite PdM - Instalación            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Verificar Node.js ──────────────────────────────────
if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js no está instalado.${NC}"
    echo "  Descárgalo desde: https://nodejs.org (versión 18 o superior)"
    exit 1
fi
NODE_VER=$(node -v)
echo -e "${GREEN}✓ Node.js encontrado:${NC} $NODE_VER"

# ── 2. Verificar npm ─────────────────────────────────────
if ! command -v npm &>/dev/null; then
    echo -e "${RED}✗ npm no encontrado. Reinstala Node.js.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm encontrado:${NC} $(npm -v)"

# ── 3. Instalar dependencias ─────────────────────────────
echo ""
echo "▶ Instalando dependencias Node.js..."
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Error al ejecutar npm install. Revisa tu conexión.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Dependencias instaladas.${NC}"

# ── 4. Verificar PostgreSQL ──────────────────────────────
echo ""
if ! command -v psql &>/dev/null; then
    echo -e "${YELLOW}⚠ psql no encontrado en PATH.${NC}"
    echo "  Si PostgreSQL está instalado en otro lugar, ejecuta el SQL manualmente:"
    echo "  psql -U postgres -f database_setup.sql"
else
    echo -e "${GREEN}✓ psql encontrado:${NC} $(psql --version)"

    # ── 5. Configurar .env ───────────────────────────────
    echo ""
    echo "▶ Configuración de la base de datos"
    echo "  (Presiona Enter para usar el valor entre corchetes)"
    echo ""

    read -p "  Usuario PostgreSQL [postgres]: " DB_USER
    DB_USER=${DB_USER:-postgres}

    read -s -p "  Contraseña PostgreSQL: " DB_PASS
    echo ""

    read -p "  Host [localhost]: " DB_HOST
    DB_HOST=${DB_HOST:-localhost}

    read -p "  Puerto [5432]: " DB_PORT
    DB_PORT=${DB_PORT:-5432}

    read -p "  Nombre de la base de datos [edwards_pdm_db]: " DB_NAME
    DB_NAME=${DB_NAME:-edwards_pdm_db}

    # Escribir .env
    cat > .env << ENV
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_HOST=$DB_HOST
DB_DATABASE=$DB_NAME
DB_PORT=$DB_PORT
ENV
    echo -e "${GREEN}✓ Archivo .env creado.${NC}"

    # ── 6. Crear base de datos y tablas ──────────────────
    echo ""
    echo "▶ Creando base de datos y tablas..."
    PGPASSWORD=$DB_PASS psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -f database_setup.sql
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ Error al ejecutar el script SQL.${NC}"
        echo "  Verifica usuario/contraseña y que PostgreSQL esté corriendo."
        echo "  Puedes ejecutarlo manualmente luego:"
        echo "  psql -U $DB_USER -h $DB_HOST -f database_setup.sql"
    else
        echo -e "${GREEN}✓ Base de datos configurada correctamente.${NC}"
    fi
fi

# ── 7. Resumen final ─────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Instalación completada             ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo -e "  Para iniciar el servidor:"
echo -e "  ${GREEN}npm start${NC}      → producción"
echo -e "  ${GREEN}npm run dev${NC}   → con recarga automática"
echo ""
echo -e "  Luego abre: ${GREEN}http://localhost:3000${NC}"
echo ""
