@echo off
REM Launches a new command prompt that tails the Java log in real time.
REM This batch file assumes that Node.js is installed and available on the PATH.

start cmd /k node ""%~dp0\javascript\view_logs.js"" ""%~dp0\logs\java.log""