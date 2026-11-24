@echo off
cd /d "%~dp0"
py -3.12 -m venv .venv
if errorlevel 1 goto error
.venv\Scripts\python -m pip install -r requirements-build.txt
if errorlevel 1 goto error
if not exist vendor\encoder\ffmpeg.exe (
 echo Falta vendor\encoder\ffmpeg.exe. Descarga el artefacto minimal-windows-encoder de GitHub Actions.
 goto error
)
.venv\Scripts\python -m PyInstaller --clean --noconfirm Dropper.spec
if errorlevel 1 goto error
copy /Y dist\Dropper.exe dist\HERS-Dropper.exe > nul
if errorlevel 1 exit /b 1
echo Ejecutable creado en dist\HERS-Dropper.exe
pause
exit /b 0
:error
echo No se completo la compilacion.
pause
exit /b 1
