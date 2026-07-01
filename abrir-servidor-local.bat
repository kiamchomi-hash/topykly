@echo off
title TOPYKLY - servidor local
cd /d "%~dp0"

echo Iniciando servidor local de TOPYKLY...
echo URL: http://127.0.0.1:4173
echo.

start "" "http://127.0.0.1:4173"
node local-server.cjs

echo.
echo El servidor se detuvo. Presiona una tecla para cerrar.
pause >nul
