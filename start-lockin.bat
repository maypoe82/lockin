@echo off
REM ============================================
REM  LockIn - double-click to start the app
REM ============================================
cd /d "%~dp0"
title LockIn

where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Docker is not installed.
  echo  Install Docker Desktop from https://www.docker.com/products/docker-desktop/
  echo  then open it once and double-click this file again.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Docker Desktop is installed but not running.
  echo  Open Docker Desktop, wait until it says "Engine running", then try again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo  Created .env from .env.example
)

echo.
echo  Starting LockIn... first time takes a few minutes.
echo  When you see "LockIn running", open http://localhost:3000
echo  Close this window or press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 45 >nul && start http://localhost:3000"
docker compose up --build
pause
