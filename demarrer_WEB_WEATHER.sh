#!/bin/sh
# Lancement de web_weather (Linux, macOS, Raspberry Pi) : garde le terminal ouvert en cas d'erreur.
#   ./demarrer_WEB_WEATHER.sh [--port 8792] [--local] [--sans-navigateur] [--sans-pause] [--sans-maj]
cd "$(dirname "$0")" || exit 1
# Un seul fichier a cliquer : le lanceur Windows (.cmd) et les anciens lancer.* sont masques.
ls *.cmd lancer.* > .hidden 2>/dev/null
. ./scripts/binaires.sh
# L'outil sort avec le code 75 quand il vient de se mettre a jour (git, ou archive de production) :
# on reprend l'executable de la nouvelle version, puis on le relance.
export WEB_WEATHER_RELANCEUR=1
while :; do
  obtenir_binaires && bin/weather "$@"
  code=$?
  [ "$code" -eq 75 ] || break
done
if [ "$code" -ne 0 ]; then
  echo
  echo "[X] Le demarrage a echoue. La raison est ecrite au-dessus."
  echo
  printf "Appuyez sur Entree pour fermer..."; read -r _
fi
exit "$code"
