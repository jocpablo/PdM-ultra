@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Suite PdM — Restauración de Base de Datos
REM  IMPORTANTE: Detén el servidor Node.js antes de ejecutar esto
REM ═══════════════════════════════════════════════════════════════

SET PGBIN=C:\Program Files\PostgreSQL\16\bin
SET PGUSER=postgres
SET PGPASSWORD=postgres
SET DB=edwards_pdm_db
SET PGHOST=localhost
SET PGPORT=5432
SET BACKUPDIR=C:\Respaldos\PDM

echo.
echo ═══════════════════════════════════════════════════════════════
echo   Suite PdM — Restauración de Base de Datos
echo ═══════════════════════════════════════════════════════════════
echo.
echo ADVERTENCIA: Asegúrate de haber detenido el servidor Node.js
echo antes de continuar. Los datos actuales serán reemplazados.
echo.
pause

REM ── Listar respaldos disponibles ───────────────────────────────
echo.
echo Respaldos disponibles:
echo ─────────────────────
dir "%BACKUPDIR%\*.backup" /b /o-d 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo No se encontraron archivos .backup en %BACKUPDIR%
    pause
    exit /b 1
)

echo.
set /p ARCHIVO="Ingresa el nombre del archivo a restaurar (ej: pdm_20260415_0200.backup): "

SET RUTA_COMPLETA=%BACKUPDIR%\%ARCHIVO%

IF NOT EXIST "%RUTA_COMPLETA%" (
    echo ERROR: No se encontró el archivo %RUTA_COMPLETA%
    pause
    exit /b 1
)

echo.
echo Archivo seleccionado: %RUTA_COMPLETA%
echo Base de datos destino: %DB%
echo.
echo ⚠️  ADVERTENCIA: Los datos actuales en %DB% serán REEMPLAZADOS.
echo.
set /p CONFIRMAR="¿Confirmas la restauración? Escribe SI para continuar: "

IF /I NOT "%CONFIRMAR%"=="SI" (
    echo Restauración cancelada.
    pause
    exit /b 0
)

echo.
echo [%date% %time%] Iniciando restauración...

"%PGBIN%\pg_restore.exe" -U %PGUSER% -h %PGHOST% -p %PGPORT% -d %DB% -c -F c "%RUTA_COMPLETA%"

IF %ERRORLEVEL% EQU 0 (
    echo.
    echo ═══════════════════════════════════════════════════════════════
    echo   ✅ RESTAURACIÓN EXITOSA
    echo   Base de datos restaurada desde: %ARCHIVO%
    echo.
    echo   SIGUIENTE PASO: Inicia el servidor con INICIAR.bat
    echo ═══════════════════════════════════════════════════════════════
) ELSE (
    echo.
    echo ═══════════════════════════════════════════════════════════════
    echo   ❌ ERROR EN LA RESTAURACIÓN
    echo   Revisa que PostgreSQL esté corriendo y las credenciales
    echo   en este script sean correctas.
    echo ═══════════════════════════════════════════════════════════════
)

echo.
pause
