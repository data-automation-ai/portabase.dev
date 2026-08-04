@echo off
title Portabase - Create export permissions (easy)
cd /d "%~dp0\.."
echo.
echo  This will open a simple question wizard.
echo  It creates the smallest AWS permissions for backup export.
echo  You normally do NOT need the AWS website.
echo.
echo  You must already be logged into AWS on this PC
echo  (someone ran "aws configure" with an admin key once).
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-export-iam-grants.ps1"
echo.
pause
