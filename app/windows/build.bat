@echo off
rem Builds the Windows app into app\windows\dist\
cd /d "%~dp0..\core"
call npm install
call npx electron-builder --win --config ..\windows\electron-builder.yml
