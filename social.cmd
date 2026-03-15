@echo off
setlocal
set ROOT=%~dp0
set TUI=%ROOT%social-tui\social-tui.exe
set SOCIAL_BIN=%APPDATA%\npm\social.cmd
if not exist "%TUI%" (
  echo social-tui binary not found at %TUI%
  echo Build it with:
  echo   cd %ROOT%social-tui
  echo   go build -o social-tui .
  exit /b 1
)
"%TUI%" %*
