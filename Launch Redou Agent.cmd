@echo off
setlocal

title Redou Agent
cd /d "%~dp0"

set "START_SCRIPT=%~dp0start-redou-agent.ps1"

if not exist "%START_SCRIPT%" (
  echo Redou Agent launcher could not find:
  echo %START_SCRIPT%
  echo.
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell was not found on this system.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%START_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Redou Agent exited with code %EXIT_CODE%.
  echo Check the startup messages above, then press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
