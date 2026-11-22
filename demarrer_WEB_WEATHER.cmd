@echo off
rem Lancement de web_weather, a double-cliquer : garde la fenetre ouverte en cas derreur.
cd /d "%~dp0"
rem Un seul fichier a cliquer : les lanceurs de lautre systeme (.sh) et lancer.bat sont masques.
attrib +h "%~dp0*.sh" >nul 2>nul
attrib +h "%~dp0lancer.bat" >nul 2>nul
rem Loutil sort avec le code 75 quand il vient de se mettre a jour (git, ou archive de production) :
rem on reprend lexecutable de la nouvelle version, puis on le relance.
set WEB_WEATHER_RELANCEUR=1
:encore
call scripts\binaires.cmd
if errorlevel 1 goto echec
bin\weather.exe %*
if %errorlevel%==75 (
  goto encore
)
if not errorlevel 1 exit /b 0
:echec
echo.
echo [X] Le demarrage a echoue. La raison est ecrite au-dessus.
echo.
pause
