@echo off
cd /d "%~dp0"
py -3.12 -m venv .venv
if errorlevel 1 goto error
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 goto error
echo Requiere Google Chrome ya instalado. No se descarga Chromium.
echo Instalacion completada. Abre iniciar.bat
pause
exit /b 0
:error
echo No se completo la instalacion. Comprueba Python 3.12 y tu conexion.
pause
exit /b 1
