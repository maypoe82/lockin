@echo off
REM ============================================
REM  LockIn - double-click to push to GitHub
REM ============================================
cd /d "%~dp0"
title Push LockIn to GitHub

where git >nul 2>nul
if errorlevel 1 (
  echo  Git is not installed. Get it from https://git-scm.com/download/win then try again.
  pause
  exit /b 1
)

set REPO=REPLACE_WITH_REPO_URL

if not exist ".git" (
  git init -b main
)
git add .
git commit -m "LockIn: AI-powered adaptive learning platform"
git remote remove origin >nul 2>nul
git remote add origin %REPO%
git push -u origin main

echo.
echo  Done. If a GitHub login window popped up, sign in there.
pause
