@echo off
setlocal EnableDelayedExpansion
title Suite PdM - Instalacion

echo.
echo  ==========================================
echo   Suite PdM - Instalacion en Windows
echo  ==========================================
echo.

:: ── 1. Verificar Node.js ─────────────────────────────────
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Node.js no esta instalado.
    echo  Descargalo desde: https://nodejs.org
    pause & exit /b 1
)
FOR /F "tokens=*" %%i IN ('node -v') DO SET NODE_VER=%%i
echo  [OK] Node.js: %NODE_VER%

:: ── 2. Instalar dependencias ─────────────────────────────
echo.
echo  Instalando dependencias (npm install)...
call npm install >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Fallo npm install.
    pause & exit /b 1
)
echo  [OK] Dependencias instaladas.

:: ── 3. Pedir datos de conexion ───────────────────────────
echo.
echo  ==========================================
echo   Configuracion de PostgreSQL
echo   (Enter = valor entre corchetes)
echo  ==========================================
echo.
SET /P DB_USER=  Usuario [postgres]: 
IF "!DB_USER!"=="" SET DB_USER=postgres

SET /P DB_HOST=  Host [localhost]: 
IF "!DB_HOST!"=="" SET DB_HOST=localhost

SET /P DB_PORT=  Puerto [5432]: 
IF "!DB_PORT!"=="" SET DB_PORT=5432

SET /P DB_NAME=  Nombre de la BD [edwards_pdm_db]: 
IF "!DB_NAME!"=="" SET DB_NAME=edwards_pdm_db

SET /P DB_PASS=  Contrasena de PostgreSQL: 

:: ── 4. Escribir .env ─────────────────────────────────────
(
    echo DB_USER=!DB_USER!
    echo DB_PASSWORD=!DB_PASS!
    echo DB_HOST=!DB_HOST!
    echo DB_DATABASE=!DB_NAME!
    echo DB_PORT=!DB_PORT!
) > .env
echo.
echo  [OK] Archivo .env creado.

:: ── 5. Ejecutar setup con Node.js ────────────────────────
echo.
echo  Configurando base de datos...
node setup_db.js "!DB_USER!" "!DB_PASS!" "!DB_HOST!" "!DB_PORT!" "!DB_NAME!"

IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo  [ERROR] No se pudo configurar la base de datos.
    echo  Verifica que PostgreSQL este corriendo y los datos sean correctos.
    pause & exit /b 1
)

:: ── 6. Listo ─────────────────────────────────────────────
echo.
echo  ==========================================
echo   Instalacion completada.
echo.
echo   Para iniciar el servidor:
echo     npm start
echo.
echo   Luego abre en tu navegador:
echo     http://localhost:3000
echo  ==========================================
echo.
pause
