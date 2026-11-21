#!/bin/sh
# web_weather (Linux, macOS, Raspberry Pi) : obtient l'exécutable (binaires.sh) puis le lance.
#   ./lancer.sh [--port 8792] [--local] [--sans-navigateur] [--sans-pause] [--sans-maj]
cd "$(dirname "$0")" || exit 1
. ./binaires.sh
# L'outil sort avec le code 75 quand il vient de se mettre à jour (git pull) :
# on reprend l'exécutable de la nouvelle version, puis on le relance.
export WEB_WEATHER_RELANCEUR=1
while :; do
  obtenir_binaires && bin/weather "$@"
  code=$?
  [ "$code" -eq 75 ] || break
done
exit "$code"
