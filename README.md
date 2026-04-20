# Suite de Mantenimiento Predictivo — Edwards PdM

Sistema web para gestión de activos industriales y reportes de mantenimiento predictivo (vibraciones, termografía, ultrasonido).

---

## Requisitos

| Herramienta | Versión mínima | Descarga |
|-------------|----------------|----------|
| Node.js     | 18 o superior  | https://nodejs.org |
| PostgreSQL   | 13 o superior  | https://www.postgresql.org/download |

---

## Instalación rápida

### Windows
```
Doble clic en setup.bat
```

### Linux / macOS
```bash
bash setup.sh
```

El script hace todo automáticamente:
1. Verifica Node.js
2. Ejecuta `npm install`
3. Te pregunta los datos de tu PostgreSQL y crea el `.env`
4. Crea la base de datos y la tabla `equipos`

---

## Instalación manual (paso a paso)

### 1. Instalar dependencias
```bash
npm install
```

### 2. Crear el archivo `.env`
Copia `.env.example` como `.env` y edita los valores:
```
DB_USER=postgres
DB_PASSWORD=tu_contraseña
DB_HOST=localhost
DB_DATABASE=edwards_pdm_db
DB_PORT=5432
```

### 3. Crear la base de datos
Desde tu terminal con `psql` disponible:
```bash
psql -U postgres -f database_setup.sql
```

O desde **pgAdmin**: abre la herramienta Query Tool, pega el contenido de `database_setup.sql` y ejecútalo.

### 4. Iniciar el servidor
```bash
npm start          # producción
npm run dev        # desarrollo (recarga automática)
```

### 5. Abrir en el navegador
```
http://localhost:3000
```

---

## Estructura del proyecto

```
mi-proyecto-pdm/
├── server.js               ← Servidor Express + rutas API
├── database_setup.sql      ← Crea la BD y la tabla equipos
├── setup.sh                ← Instalador para Linux/macOS
├── setup.bat               ← Instalador para Windows
├── .env                    ← Variables de entorno (NO subir a Git)
├── .env.example            ← Plantilla de variables
├── package.json
└── public/
    ├── index.html          ← Menú principal (dashboard)
    ├── hojas-de-vida.html  ← Gestión de activos / fichas técnicas
    ├── monitoreo.html      ← Tablero de condición con semáforos
    ├── vibraciones.html    ← Reporte de análisis de vibraciones
    ├── termografia.html    ← Reporte de termografía
    ├── ultrasonido.html    ← Reporte de ultrasonido
    ├── reportes-generales.html ← Informes eléctricos y multiparamétricos
    ├── anexo-termo.html    ← Anexo de imágenes termográficas
    ├── anexo-ultra.html    ← Anexo de espectros de ultrasonido
    ├── js/
    │   ├── script.js           ← Lógica compartida (temas, logos, etc.)
    │   ├── monitoreo.js        ← Lógica del tablero de monitoreo
    │   ├── hojas-de-vida.js    ← CRUD de equipos
    │   ├── vibraciones_script.js
    │   ├── ultrasonido.js
    │   ├── reportes_generales.js
    │   └── anexos_shared.js
    └── *.css                   ← Estilos por módulo
```

---

## API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/equipos` | Lista todos los equipos. Filtros: `?ubicacion=X&criticidad=Alta` |
| GET | `/api/equipos/:id` | Obtiene un equipo por asset_id |
| POST | `/api/equipos` | Crea o actualiza un equipo (upsert por asset_id) |
| PATCH | `/api/equipos/:id/estado` | Actualiza solo los estados de monitoreo |
| DELETE | `/api/equipos/:id` | Elimina un equipo |

---

## Notas importantes

- Las fotos de equipos se almacenan como **Base64** directamente en PostgreSQL. Para producción con muchas fotos, considera mover las imágenes a disco o a un servicio de almacenamiento (S3, etc.).
- El archivo `.env` contiene contraseñas — **nunca lo subas a GitHub/GitLab**. Usa `.env.example` como plantilla pública.
- Los estados de monitoreo usan un solo carácter: `B` (Bueno), `A` (Alerta), `C` (Crítico), `N` (No inspeccionado).
