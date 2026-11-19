@echo off
REM ============================================
REM  LockIn - double-click to push to GitHub
REM ============================================
REM Re-open inside a window that stays open, even on errors
if not "%~1"=="run" (
  cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title Push LockIn to GitHub
set LOG=%~dp0push-log.txt
echo Push log %date% %time% > "%LOG%"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Git is not installed.
  echo  1. Download it from https://git-scm.com/download/win
  echo  2. Install it, keeping all the default options
  echo  3. Double-click this file again
  echo GIT NOT INSTALLED >> "%LOG%"
  goto :end
)

set REPO=https://github.com/maypoe82/lockin.git

if not exist ".git" git init -b main >> "%LOG%" 2>&1
git config user.name >nul 2>nul || git config user.name "maypoe82"
git config user.email >nul 2>nul || git config user.email "maypoe82@users.noreply.github.com"
git add . >> "%LOG%" 2>&1
git commit -m "LockIn: AI-powered adaptive learning platform" >> "%LOG%" 2>&1
git remote remove origin >nul 2>nul
git remote add origin %REPO%
echo.
echo  Uploading to GitHub... if a sign-in window pops up, sign in there.
git push -u origin main 2>&1
git push -u origin main >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo  Push FAILED. Send Claude a screenshot of this window.
) else (
  echo.
  echo  Done! Your code is on https://github.com/maypoe82/lockin
)

:end
echo.
echo  You can close this window now.
