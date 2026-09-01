@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-live.ps1"
if errorlevel 1 (
  echo.
  echo EMS startup failed. Check this message and the logs folder.
  pause
)
