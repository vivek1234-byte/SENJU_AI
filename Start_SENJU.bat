@echo off
rem Launch SENJU on Windows from wherever this folder lives (Linux uses senju.sh)
cd /d "%~dp0"

rem First run, or new dependencies (e.g. the MCP SDK) since the last update
if not exist "node_modules\@modelcontextprotocol\sdk" (
  echo Installing SENJU dependencies, please wait...
  call npm install
)
rem Folder copied over from Linux: fetch the Windows Electron binary
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading Electron for Windows...
  call node node_modules\electron\install.js
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
