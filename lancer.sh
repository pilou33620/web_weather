#!/bin/sh
# Ancien nom, garde pour web_launcher : relais vers demarrer_WEB_WEATHER.sh, avec les memes arguments.
exec sh "$(dirname "$0")/demarrer_WEB_WEATHER.sh" "$@"
