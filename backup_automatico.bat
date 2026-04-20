@echo off
REM ═══════════════════════════════════════════════════════════════
REM  Suite PdM — Respaldo Automático de Base de Datos
REM  Programar en Tareas de Windows para ejecución diaria
REM  Autor: Edwards PdM Suite
REM ═══════════════════════════════════════════════════════════════

REM ── Configuración ──────────────────────────────────────────────
SET PGBIN=C:\Program Files\PostgreSQL\16\bin
SET PGUSER=postgres
SET PGPASSWORD=postgres
SET DB=edwards_pdm_db
SET PGHOST=localhost
SET PGPORT=5432
SET BACKUPDIR=C:\Respaldos\PDM
SET DIAS_RETENCION=30
SET LOGFILE=%BACKUPDIR%\backup_log.txt

REM ── Crear directorio si no existe ──────────────────────────────
if not exist "%BACKUPDIR%" mkdir "%BACKUPDIR%"

REM ── Generar nombre de archivo con fecha y hora ──────────────────
REM Formato: pdm_AAAAMMDD_HHMM.backup
SET AÑO=%date:~-4%
SET MES=%date:~3,2%
SET DIA=%date:~0,2%
SET HORA=%time:~0,2%
SET MIN=%time:~3,2%
SET HORA=%HORA: =0%
SET ARCHIVO=%BACKUPDIR%\pdm_%AÑO%%MES%%DIA%_%HORA%%MIN%.backup

REM ── Ejecutar respaldo ──────────────────────────────────────────
echo [%date% %time%] Iniciando respaldo de %DB%... >> "%LOGFILE%"
echo [%date% %time%] Archivo destino: %ARCHIVO% >> "%LOGFILE%"

"%PGBIN%\pg_dump.exe" -U %PGUSER% -h %PGHOST% -p %PGPORT% -d %DB% -F c -f "%ARCHIVO%"

IF %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] EXITO: Respaldo guardado en %ARCHIVO% >> "%LOGFILE%"
    echo [%date% %time%] ✅ Respaldo exitoso
) ELSE (
    echo [%date% %time%] ERROR: Fallo al crear respaldo >> "%LOGFILE%"
    echo [%date% %time%] ❌ ERROR en el respaldo
    exit /b 1
)

REM ── Eliminar respaldos más antiguos que DIAS_RETENCION ─────────
forfiles /p "%BACKUPDIR%" /s /m *.backup /d -%DIAS_RETENCION% /c "cmd /c del @path" 2>nul
IF %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] Limpieza de respaldos antiguos completada >> "%LOGFILE%"
)

REM ── Mostrar respaldos actuales ─────────────────────────────────
echo.
echo Respaldos disponibles en %BACKUPDIR%:
dir "%BACKUPDIR%\*.backup" /b /o-d 2>nul

echo.
echo ─────────────────────────────────────────────────
echo Respaldo completado exitosamente.
echo Archivo: %ARCHIVO%
echo Log: %LOGFILE%
echo ─────────────────────────────────────────────────
