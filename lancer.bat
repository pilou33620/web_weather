@echo off
cd /d "%~dp0"
rem L outil sort avec le code 75 quand il vient de se mettre a jour (git pull) : on reprend l executable, puis on relance.
set WEB_WEATHER_RELANCEUR=1
:boucle
call binaires.cmd || goto fin
bin\weather.exe %*
if %errorlevel%==75 goto boucle
:fin
rem pas de pause sous web_launcher (--sans-pause)
echo %* | find "--sans-pause" >nul || pause
