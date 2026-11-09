@echo off
setlocal
cd /d "%~dp0.."
if errorlevel 1 exit /b 1

docker compose up -d --build
if errorlevel 1 exit /b %errorlevel%

if "%PORT%"=="" set PORT=8080
echo.
echo XYZW Web Helper is running at http://localhost:%PORT%/tokens
docker compose ps
endlocal
