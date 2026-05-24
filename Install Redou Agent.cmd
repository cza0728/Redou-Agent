@echo off
setlocal

title Redou Agent Installer
cd /d "%~dp0"

set "INSTALL_SCRIPT=%~dp0install-redou-agent.ps1"

if not exist "%INSTALL_SCRIPT%" (
  echo Redou Agent installer could not find:
  echo %INSTALL_SCRIPT%
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

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Redou Agent installation completed.
  echo You can now run:
  echo   Launch Redou Agent.lnk
  echo or:
  echo   Launch Redou Agent.cmd
) else (
  echo Redou Agent installation failed with code %EXIT_CODE%.
  echo Check the messages above, then press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
