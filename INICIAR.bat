@echo off
setlocal EnableDelayedExpansion
title Suite PdM - Edwards
cd /d "%~dp0"

echo.
echo  ==========================================
echo   Suite PdM - Edwards
echo  ==========================================
echo.

:: Verificar Node.js
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Node.js no esta instalado.
    echo  Descargalo desde: https://nodejs.org
    pause & exit /b 1
)
FOR /F "tokens=*" %%i IN ('node -v') DO SET NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

:: Instalar dependencias si no existen
IF NOT EXIST "node_modules\express" (
    echo.
    echo  Instalando dependencias...
    call npm install
    IF %ERRORLEVEL% NEQ 0 (
        call npm install --legacy-peer-deps
        IF %ERRORLEVEL% NEQ 0 (
            echo  [ERROR] No se pudo instalar.
            pause & exit /b 1
        )
    )
    echo  [OK] Dependencias instaladas.
) ELSE (
    echo  [OK] Dependencias listas.
)

:: Primera vez: configurar .env
IF NOT EXIST ".env" (
    echo.
    echo  Configuracion inicial de PostgreSQL:
    echo.
    SET /P DB_USER=  Usuario [postgres]: 
    IF "!DB_USER!"=="" SET DB_USER=postgres
    SET /P DB_HOST=  Host [localhost]: 
    IF "!DB_HOST!"=="" SET DB_HOST=localhost
    SET /P DB_PORT=  Puerto BD [5432]: 
    IF "!DB_PORT!"=="" SET DB_PORT=5432
    SET /P DB_NAME=  Nombre BD [edwards_pdm_db]: 
    IF "!DB_NAME!"=="" SET DB_NAME=edwards_pdm_db
    SET /P DB_PASS=  Contrasena de PostgreSQL: 
    (
        echo DB_USER=!DB_USER!
        echo DB_PASSWORD=!DB_PASS!
        echo DB_HOST=!DB_HOST!
        echo DB_DATABASE=!DB_NAME!
        echo DB_PORT=!DB_PORT!
        echo PORT=3000
        echo APP_USER=admin
        echo APP_PASSWORD=pdm2026
        echo SESSION_SECRET=edwards-pdm-secret-2026
    ) > .env
    echo  [OK] Configuracion guardada.
    echo  Configurando base de datos...
    node setup_db.js "!DB_USER!" "!DB_PASS!" "!DB_HOST!" "!DB_PORT!" "!DB_NAME!"
    IF %ERRORLEVEL% NEQ 0 (
        echo  [ERROR] No se pudo conectar a PostgreSQL.
        del .env >nul 2>&1
        pause & exit /b 1
    )
    echo  [OK] Base de datos lista.
) ELSE (
    echo  [OK] Configuracion encontrada.
)

:: Borrar archivo de puerto anterior
SET PORTFILE=%TEMP%\pdm_actual_port.txt
IF EXIST "%PORTFILE%" del "%PORTFILE%" >nul 2>&1

:: Lanzar servidor en ventana SEPARADA (no interfiere con otros proyectos)
echo.
echo  Iniciando servidor en ventana separada...
start "Suite PdM Server" /D "%~dp0" node server.js

:: Esperar que el servidor escriba el puerto (max 15 segundos)
echo  Esperando que el servidor arranque...
SET /A WAIT=0
:WAIT_PORT
IF EXIST "%PORTFILE%" GOTO PORT_FOUND
SET /A WAIT+=1
IF !WAIT! GEQ 15 GOTO PORT_TIMEOUT
timeout /t 1 >nul 2>&1
GOTO WAIT_PORT

:PORT_FOUND
SET /P ACTUAL_PORT=<"%PORTFILE%"
echo.
echo  ==========================================
echo   Suite PdM lista en:
echo   http://localhost:!ACTUAL_PORT!
echo.
echo   Usuario: admin
echo   Clave:   pdm2026
echo.
echo   El servidor corre en su propia ventana.
echo   Cierra ESA ventana para detenerlo.
echo  ==========================================
echo.
start "" "http://localhost:!ACTUAL_PORT!"
GOTO END

:PORT_TIMEOUT
echo.
echo  [WARN] El servidor tardo en responder.
echo  Revisa la ventana del servidor para ver errores.
echo  Intentando abrir http://localhost:3000 por defecto.
start "" "http://localhost:3000"

:END
echo  Presiona cualquier tecla para cerrar este launcher.
pause >nul
