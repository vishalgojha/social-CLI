@echo off
setlocal

set "SCRIPT=%~dp0install.ps1"
if not exist "%SCRIPT%" (
  echo install.ps1 not found.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo Installer failed with exit code %CODE%.
  pause
  exit /b %CODE%
)

echo.
echo Installer finished successfully.
choice /C YN /N /T 20 /D N /M "Launch Social CLI now? [Y/N] (auto N in 20s): " 2>nul
if errorlevel 3 goto :end
if errorlevel 2 goto :end

where social.cmd >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  call social.cmd
) else (
  echo social command not on PATH yet. Launching local CLI...
  node "%~dp0bin\social.js"
)

:end
pause
exit /b 0
