@echo off
REM One-click setup and launch for MiniMe on Windows.
REM Installs dependencies the first time, then starts the app.

cd /d "%~dp0"
title MiniMe

echo.
echo   MiniMe
echo   ------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed.
  echo.
  echo   Install it from https://nodejs.org  ^(pick the LTS version^),
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo   First run - installing dependencies. This takes a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

echo   Starting MiniMe. Closing this window will close MiniMe.
echo   To quit properly, use the tray icon ^> Quit.
echo.
call npm start
