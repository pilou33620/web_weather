#!/usr/bin/python3
# =============================================================================
# web_weather — serveur.py
#
# PAS « /usr/bin/env python3 » en première ligne : sous Windows, py.exe ne
# reconnaît que « /usr/bin/python3 » (voir REGLES-NOUVEAU-WEB-TOOL.md §3.4).
#
# Météo orientée orage. Le navigateur ne parle qu'à ce serveur, qui relaie et
# garde en cache :
#   - Open-Meteo (prévisions, LPI ICON-D2, modèles, Ensemble, grille CAPE, lieux) ;
#   - RainViewer (images radar de pluie) ;
#   - les tuiles OpenStreetMap (fond de carte, cache disque) ;
#   - Blitzortung (impacts de foudre en temps réel, foudre.py).
# Le score de risque et les alertes se calculent dans la page (js/calc.js) : les
# seuils sont des réglages de chaque appareil.
#
# Bibliothèque standard uniquement.
# =============================================================================

import argparse
import http.server
import json
import math
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone

import appairage
import foudre

RACINE = os.path.dirname(os.path.abspath(__file__))
CACHE_DISQUE = os.path.join(RACINE, "cache")          # tuiles OSM ; ignoré par git
AGENT = "web_weather/1.0 (+https://github.com/pilou33620/web_weather)"

# Ce que la page charge, et rien d'autre du dossier (ni .git/, ni les scripts).
STATIQUE = re.compile(
    r"^/(?:index\.html)?$"
    r"|^/(?:css|js|vendor)(?:/[\w-][\w.-]*)+$",
    re.IGNORECASE)

OM = "https://api.open-meteo.com/v1/forecast"
OM_ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble"
OM_LIEUX = "https://geocoding-api.open-meteo.com/v1/search"
RAINVIEWER = "https://api.rainviewer.com/public/weather-maps.json"
OSM = "https://tile.openstreetmap.org/%d/%d/%d.png"

ACTUEL = ("temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,"
          "wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,precipitation")
HORAIRE = ("temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,"
           "precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,"
           "pressure_msl,cloud_cover,cape,lifted_index,convective_inhibition,freezing_level_height,"
           "uv_index,visibility")
QUOTIDIEN = ("weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
             "precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max")
MODELES = "meteofrance_seamless,icon_seamless,ecmwf_ifs025,gfs_seamless"

GRILLE_N = 15                 # 15×15 points…
GRILLE_KM = 150               # …sur environ 150 km : 225 appels par heure et par lieu
RAYON_FOUDRE_KM = 300
RADAR_ZOOM_MAX = 7            # conditions RainViewer
OSM_ZOOM_MAX = 13
OSM_DUREE = 7 * 86400         # une tuile OSM gardée 7 jours

FOUDRE = foudre.Foudre()      # démarré dans main() ; vide dans les bancs


class ErreurSource(Exception):
    """Une source externe n'a pas répondu : message court, sans chemin disque."""


class ParametreInvalide(ValueError):
    """Paramètre de la page refusé (400) ; toute autre erreur vient d'une source (502)."""


# --- Appels sortants et cache mémoire ------------------------------------------

def telecharger(url, max_octets=8 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    hote = urllib.parse.urlsplit(url).hostname
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            corps = r.read(max_octets + 1)
    except urllib.error.HTTPError as e:
        raise ErreurSource("%s : HTTP %d" % (hote, e.code)) from None
    except (urllib.error.URLError, OSError) as e:
        raise ErreurSource("%s injoignable" % hote) from e
    if len(corps) > max_octets:
        raise ErreurSource("%s : réponse trop grande" % hote)
    return corps


def lire_json(corps, hote):
    try:
        return json.loads(corps)
    except ValueError:
        raise ErreurSource("%s : réponse illisible" % hote) from None


def json_de(url, **params):
    return lire_json(telecharger(url + "?" + urllib.parse.urlencode(params)), urllib.parse.urlsplit(url).hostname)


_CACHE, _EN_COURS, _VERROU = {}, {}, threading.Lock()
CACHE_MAX = 1500    # shortcut: borne en nombre d'entrées, pas en octets ; à revoir si la mémoire du Pi souffre


def en_cache(cle, duree, calcul):
    """La valeur gardée si elle a moins de `duree` secondes, sinon calcul() (les erreurs ne se gardent pas).
    Un seul calcul à la fois par clé : deux appareils qui demandent la grille ensemble ne coûtent qu'un appel."""
    with _VERROU:
        verrou = _EN_COURS.setdefault(cle, threading.Lock())
    with verrou:
        with _VERROU:
            trouve = _CACHE.get(cle)
        if trouve and trouve[0] > time.time():
            return trouve[1]
        valeur = calcul()
        with _VERROU:
            if len(_CACHE) >= CACHE_MAX:
                for k in list(_CACHE)[:CACHE_MAX // 2]:       # les plus anciennes entrées d'abord
                    del _CACHE[k]
                    _EN_COURS.pop(k, None)
            _CACHE.pop(cle, None)                             # réinsérée en fin : l'ordre suit la fraîcheur
            _CACHE[cle] = (time.time() + duree, valeur)
        return valeur


# --- Ce que sert l'API ----------------------------------------------------------

def coordonnees(requete, pas=0.01):
    """(lat, lon) arrondis à `pas`, ou ValueError. Un lieu arrondi partage son cache."""
    q = urllib.parse.parse_qs(requete)
    try:
        lat, lon = float(q["lat"][0]), float(q["lon"][0])
    except (KeyError, ValueError):
        raise ParametreInvalide from None
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ParametreInvalide
    return round(round(lat / pas) * pas, 4), round(round(lon / pas) * pas, 4)


def meteo(lat, lon):
    def calcul():
        prevision = json_de(OM, latitude=lat, longitude=lon, timezone="auto", forecast_days=10,
                            wind_speed_unit="kmh", current=ACTUEL, hourly=HORAIRE, daily=QUOTIDIEN)
        # Le LPI n'existe qu'avec ICON-D2 (Europe centrale) : appel séparé, absent ailleurs
        try:
            l = json_de(OM, latitude=lat, longitude=lon, timezone="auto", forecast_days=2,
                        models="icon_d2", hourly="lightning_potential")["hourly"]
            lpi = {"time": l["time"], "valeurs": l["lightning_potential"]}
            if all(v is None for v in lpi["valeurs"]):
                lpi = None
        except (ErreurSource, KeyError, ValueError):
            lpi = None
        return {"prevision": prevision, "lpi": lpi}
    return en_cache(("meteo", lat, lon), 600, calcul)


def modeles(lat, lon):
    return en_cache(("modeles", lat, lon), 1800, lambda: json_de(
        OM, latitude=lat, longitude=lon, timezone="auto", forecast_days=3, wind_speed_unit="kmh",
        models=MODELES, hourly="temperature_2m,precipitation,wind_gusts_10m,cape"))


def ensemble(lat, lon):
    return en_cache(("ensemble", lat, lon), 3600, lambda: json_de(
        OM_ENSEMBLE, latitude=lat, longitude=lon, timezone="auto", forecast_days=3,
        models="icon_seamless", hourly="temperature_2m,precipitation"))


def points_grille(lat, lon):
    dlat = GRILLE_KM / (GRILLE_N - 1) / 111.32
    dlon = dlat / max(0.1, math.cos(math.radians(lat)))
    m = GRILLE_N // 2
    lats = [round(lat + (i - m) * dlat, 3) for i in range(GRILLE_N)]
    lons = [round(lon + (j - m) * dlon, 3) for j in range(GRILLE_N)]
    return lats, lons


def grille(lat, lon):
    """CAPE des 24 prochaines heures sur la grille : cape[h][i * N + j] (i : latitude, j : longitude)."""
    def calcul():
        lats, lons = points_grille(lat, lon)
        pts = [(a, b) for a in lats for b in lons]
        rep = json_de(OM, latitude=",".join(str(a) for a, _ in pts),
                      longitude=",".join(str(b) for _, b in pts),
                      hourly="cape", forecast_days=2, timezone="auto")
        decalage = timedelta(seconds=rep[0]["utc_offset_seconds"])
        maintenant = (datetime.now(timezone.utc) + decalage).strftime("%Y-%m-%dT%H:00")
        heures = rep[0]["hourly"]["time"]
        debut = next((k for k, t in enumerate(heures) if t >= maintenant), 0)
        fin = min(debut + 24, len(heures))
        return {"lats": lats, "lons": lons, "time": heures[debut:fin],
                "cape": [[p["hourly"]["cape"][k] for p in rep] for k in range(debut, fin)]}
    return en_cache(("grille", lat, lon), 3600, calcul)


def radar_brut():
    def calcul():
        r = lire_json(telecharger(RAINVIEWER), "api.rainviewer.com")
        return {"host": str(r["host"]), "images": {f["time"]: f["path"] for f in r["radar"]["past"]}}
    return en_cache("radar", 120, calcul)


def radar():
    return {"images": list(radar_brut()["images"]), "zoom_max": RADAR_ZOOM_MAX}


def tuile_radar(t, z, x, y):
    if z > RADAR_ZOOM_MAX or not (0 <= x < 1 << z and 0 <= y < 1 << z):
        return None
    r = radar_brut()
    # Le chemin vient de la liste de RainViewer : la page ne choisit qu'une heure de cette liste
    chemin = r["images"].get(t)
    if not chemin:
        return None
    url = "%s%s/256/%d/%d/%d/2/1_1.png" % (r["host"], chemin, z, x, y)
    return en_cache(url, 7200, lambda: telecharger(url, 1 << 20))


def tuile_osm(z, x, y):
    """Tuile OSM depuis le cache disque (7 jours), sinon téléchargée puis rangée.
    Si OSM ne répond pas, une tuile périmée vaut mieux que rien."""
    if z > OSM_ZOOM_MAX or not (0 <= x < 1 << z and 0 <= y < 1 << z):
        return None
    fichier = os.path.join(CACHE_DISQUE, "osm", str(z), str(x), "%d.png" % y)
    try:
        if time.time() - os.path.getmtime(fichier) < OSM_DUREE:
            with open(fichier, "rb") as f:
                return f.read()
    except OSError:
        pass
    try:
        corps = telecharger(OSM % (z, x, y), 1 << 20)
    except ErreurSource:
        if os.path.isfile(fichier):
            with open(fichier, "rb") as f:
                return f.read()
        raise
    # shortcut: le cache disque n'est jamais purgé ; quelques dizaines de Mo autour d'un lieu, à purger si on voyage beaucoup
    os.makedirs(os.path.dirname(fichier), exist_ok=True)
    tmp = "%s.%d.tmp" % (fichier, threading.get_ident())
    with open(tmp, "wb") as f:
        f.write(corps)
    os.replace(tmp, fichier)
    return corps


def lieux(texte):
    texte = texte.strip()
    if not 2 <= len(texte) <= 60:
        raise ParametreInvalide
    def calcul():
        rep = json_de(OM_LIEUX, name=texte, count=8, language="fr", format="json")
        return [{"nom": r.get("name", ""), "region": r.get("admin1", ""), "pays": r.get("country", ""),
                 "lat": r["latitude"], "lon": r["longitude"]} for r in rep.get("results", [])]
    return en_cache(("lieux", texte.lower()), 86400, calcul)


def impacts(lat, lon):
    return {"maintenant": int(time.time() * 1000), "etat": FOUDRE.etat(),
            "impacts": FOUDRE.autour(lat, lon, RAYON_FOUDRE_KM)}


API = {
    "/api/meteo": lambda q: meteo(*coordonnees(q)),
    "/api/modeles": lambda q: modeles(*coordonnees(q)),
    "/api/ensemble": lambda q: ensemble(*coordonnees(q)),
    "/api/grille": lambda q: grille(*coordonnees(q, 0.1)),
    "/api/foudre": lambda q: impacts(*coordonnees(q)),
    "/api/radar": lambda q: radar(),
    "/api/lieux": lambda q: lieux(urllib.parse.parse_qs(q).get("q", [""])[0]),
}
TUILE = re.compile(r"^/tuiles/(?:osm|radar/(\d{9,11}))/(\d{1,2})/(\d{1,6})/(\d{1,6})\.png$")


# --- Serveur HTTP ----------------------------------------------------------------

GARDE = appairage.Garde("WEB_WEATHER", actif=False)   # remplacé dans main() selon --local


class Gestionnaire(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RACINE, **kwargs)

    def parse_request(self):
        # Host, Internet, TLS, jeton : avant tout traitement de la requête
        return super().parse_request() and GARDE.filtrer(self)

    def send_head(self):
        # GET et HEAD passent tous deux par ici
        chemin = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if not STATIQUE.match(chemin):
            self.send_error(404, "File not found")
            return None
        return super().send_head()

    def do_GET(self):
        morceaux = urllib.parse.urlsplit(self.path)
        if morceaux.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        route, tuile = API.get(morceaux.path), TUILE.match(morceaux.path)
        if not route and not tuile:
            return super().do_GET()
        try:
            if route:
                return self._json(route(morceaux.query))
            t, z, x, y = (int(v) if v else None for v in tuile.groups())
            corps = tuile_radar(t, z, x, y) if morceaux.path.startswith("/tuiles/radar/") else tuile_osm(z, x, y)
            if corps is None:
                return self._json({"detail": "Tuile inconnue"}, 404)
            self._envoyer(corps, "image/png")
        except ParametreInvalide:
            self._json({"detail": "Paramètres invalides"}, 400)
        except ErreurSource as e:
            self._json({"detail": str(e)}, 502)
        except (ValueError, KeyError, IndexError, TypeError):
            # Une source a changé de format : le dire, plutôt qu'accuser la page
            self._json({"detail": "Réponse inattendue d'une source"}, 502)

    def _envoyer(self, corps, type_, code=200):
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def _json(self, charge, code=200):
        self._envoyer(json.dumps(charge, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
                      "application/json; charset=utf-8", code)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format, *args):
        # Les requêtes réussies ordinaires (page, API, tuiles) ne remplissent pas le journal
        if args and str(args[0]).startswith(("GET", "HEAD")) and str(args[1]) in ("200", "204"):
            return
        super().log_message("%s", appairage.masquer(format % args))

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            self.close_connection = True       # client parti : pas une erreur


class Serveur(socketserver.ThreadingTCPServer):
    # SO_REUSEADDR laisserait sous Windows deux serveurs partager un port
    allow_reuse_address = os.name != "nt"
    daemon_threads = True


class ServeurDoublePile(Serveur):
    """IPv4 et IPv6 sur la même socket (Tailscale fd7a::) quand le système le permet."""
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except AttributeError as exc:
            raise OSError("IPV6_V6ONLY absent : pas de double pile") from exc
        super().server_bind()


def ipv4_libre(port):
    """Sous Windows, une socket double pile se lie même si l'IPv4 du port est déjà pris."""
    if os.name != "nt":
        return True
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def adresse_locale():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))     # aucun paquet n'est envoyé
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def ouvrir_serveur(hote, port, essais):
    """Le premier port libre à partir de `port`."""
    derniere = OSError("aucun port essayé")
    piles = [(ServeurDoublePile, "::"), (Serveur, hote)] if hote == "0.0.0.0" else [(Serveur, hote)]
    for p in range(port, port + essais):
        if hote == "0.0.0.0" and not ipv4_libre(p):
            derniere = OSError(f"l'IPv4 du port {p} est déjà pris")
            continue
        for classe, h in piles:
            try:
                return classe((h, p), Gestionnaire), p
            except OSError as e:
                derniere = e
    raise derniere


def verifier_et_appliquer_maj(dossier_racine=None):
    """Recherche les mises a jour sur GitHub via Git et les applique si disponible.

    Renvoie True si une mise a jour a ete telechargee et appliquee avec succes
    (necessitant un redemarrage du script pour executer le code a jour), ou False
    si l'outil est deja a jour, hors-ligne, ou dans l'impossibilite d'appliquer
    la mise a jour sans intervention manuelle.
    """
    racine = dossier_racine or RACINE
    # Git doit etre disponible dans l'environnement
    if not shutil.which("git"):
        return False

    # Le dossier doit etre un depot Git
    dossier_git = os.path.join(racine, ".git")
    if not os.path.isdir(dossier_git):
        res_test = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=racine, capture_output=True, text=True
        )
        if res_test.returncode != 0:
            return False

    print("[*] Recherche de mises a jour sur GitHub...")
    env_git = os.environ.copy()
    env_git["GIT_TERMINAL_PROMPT"] = "0"

    try:
        fetch = subprocess.run(
            ["git", "fetch", "--quiet", "origin"],
            cwd=racine, capture_output=True, text=True, timeout=10, env=env_git
        )
        if fetch.returncode != 0:
            print("[!] Impossible de contacter GitHub (hors ligne ou depot distant inaccessible).")
            print("[*] Demarrage normal de l'outil...")
            return False
    except subprocess.TimeoutExpired:
        print("[!] Delai de recherche de mise a jour depasse (reseau lent ou indisponible).")
        print("[*] Demarrage normal de l'outil...")
        return False
    except Exception as exc:                           # noqa: BLE001
        print("[!] Echec de la recherche de mise a jour : %s" % exc)
        print("[*] Demarrage normal de l'outil...")
        return False

    # Determination de la branche amont (upstream) ou repli sur origin/main
    upstream = "@{u}"
    res_up = subprocess.run(
        ["git", "rev-parse", "--verify", "@{u}"],
        cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
    )
    if res_up.returncode != 0:
        res_main = subprocess.run(
            ["git", "rev-parse", "--verify", "origin/main"],
            cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
        )
        if res_main.returncode == 0:
            upstream = "origin/main"
        else:
            # Aucune branche amont connue
            return False

    # Nombre de commits distants en attente de recuperation
    res_count = subprocess.run(
        ["git", "rev-list", "HEAD..%s" % upstream, "--count"],
        cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
    )
    if res_count.returncode != 0:
        return False

    try:
        nb_commits = int(res_count.stdout.strip())
    except ValueError:
        return False

    if nb_commits <= 0:
        print("[*] Le logiciel est a jour.")
        return False

    print()
    print("=" * 60)
    print("MISE A JOUR DISPONIBLE (%d nouveau(x) commit(s) sur GitHub)" % nb_commits)
    print("=" * 60)
    print("  Application de la mise a jour en cours...")

    # Detection de modifications locales non commitees dans les fichiers suivis
    st_res = subprocess.run(
        ["git", "status", "--porcelain", "-uno"],
        cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
    )
    dirty = bool(st_res.stdout.strip())
    stashed = False
    if dirty:
        print("  Modifications locales detectees : mise en reserve temporaire...")
        stash_res = subprocess.run(
            ["git", "stash", "push", "-m", "Auto-stash WEB_WEATHER avant mise a jour"],
            cwd=racine, capture_output=True, text=True, timeout=10, env=env_git
        )
        stashed = (stash_res.returncode == 0)

    # --ff-only : on n'applique que la suite exacte de ce qu'on a. Un historique
    # distant reecrit (force-push) ou divergent est refuse, jamais fusionne en
    # silence dans le code qu'on va executer.
    # Un pull trop long (reseau lent, carte SD) levait TimeoutExpired : le
    # serveur ne demarrait pas et la reserve n'etait jamais reappliquee.
    try:
        pull = subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=racine, capture_output=True, text=True, timeout=120, env=env_git
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        pull = subprocess.CompletedProcess(["git", "pull"], 1, "",
                                           "git pull interrompu (%s)" % exc)

    if stashed:
        print("  Restauration des modifications locales...")
        pop = subprocess.run(
            ["git", "stash", "pop"],
            cwd=racine, capture_output=True, text=True, timeout=10, env=env_git
        )
        # Un « pop » en conflit laisse les modifications dans la reserve (et
        # des marqueurs de conflit dans les fichiers) : le taire, c'etait
        # laisser croire qu'elles etaient perdues.
        if pop.returncode != 0:
            err = pop.stderr.strip() or pop.stdout.strip()
            print("[!] Vos modifications locales n'ont pas pu etre reappliquees"
                  " automatiquement :")
            print("    %s" % err)
            print("    Elles sont conservees dans la reserve Git : voir"
                  " « git stash list », puis « git stash pop » une fois le"
                  " conflit resolu.")

    if pull.returncode != 0:
        err = pull.stderr.strip() or pull.stdout.strip()
        print("[!] Echec de l'application de la mise a jour : %s" % err)
        print("[*] Poursuite avec la version actuelle...")
        return False

    print()
    print("=" * 60)
    print("MISE A JOUR APPLIQUEE AVEC SUCCES")
    print("=" * 60)
    print("  Redemarrage automatique de l'outil...")
    print("=" * 60)
    print()
    return True


def redemarrer_application(argv=None):
    """Relance le processus actuel avec les memes arguments apres une mise a jour."""
    env = os.environ.copy()
    env["WEB_WEATHER_DEJA_MAJ"] = "1"
    cmd = [sys.executable, os.path.abspath(__file__)] + (sys.argv[1:] if argv is None else list(argv))
    try:
        if os.name == "nt":
            # Sous Windows, subprocess.call permet de conserver la fenetre console
            # ouverte (en particulier lors d'un lancement par double-clic).
            code = subprocess.call(cmd, env=env)
            os._exit(code)
        else:
            # Sous Unix / macOS, execv remplace l'image du processus courant
            os.execv(sys.executable, cmd)
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as exc:                           # noqa: BLE001
        print("[!] Erreur lors du redemarrage automatique : %s" % exc)
        print("[*] Poursuite avec le processus actuel...")


def main():
    ap = argparse.ArgumentParser(description="web_weather : météo orientée orage.")
    ap.add_argument("--port", type=int, default=8792, help="port d'écoute (8792 par défaut)")
    ap.add_argument("--local", action="store_true", help="n'écouter que sur 127.0.0.1")
    ap.add_argument("--sans-navigateur", action="store_true", help="ne pas ouvrir le navigateur")
    ap.add_argument("--sans-pause", action="store_true", help="ne pas attendre de touche à l'arrêt")
    ap.add_argument("--sans-maj", dest="verifier_maj", action="store_false", default=True,
                    help="ne pas vérifier les mises à jour GitHub au démarrage")
    args = ap.parse_args()
    # shortcut: pause seulement sous Windows (double-clic) ; WEB_3D détecte finement la console, à reprendre si gênant
    interactif = not args.sans_pause and os.name == "nt" and sys.stdin.isatty()

    def attendre():
        if interactif:
            try:
                input("\nAppuyez sur Entrée pour fermer…")
            except EOFError:
                pass

    if args.verifier_maj and os.environ.get("WEB_WEATHER_DEJA_MAJ") != "1":
        if verifier_et_appliquer_maj(RACINE):
            redemarrer_application()

    hote = "127.0.0.1" if args.local else "0.0.0.0"
    global GARDE
    GARDE = appairage.Garde("WEB_WEATHER", actif=not args.local)
    try:
        serveur, port = ouvrir_serveur(hote, args.port, 10)
    except OSError as e:
        print(f"Aucun port libre entre {args.port} et {args.port + 9} : {e}", file=sys.stderr, flush=True)
        attendre()
        return 1

    GARDE.brancher(serveur)             # en mode réseau : HTTPS sur le même port
    FOUDRE.demarrer()
    url = f"http://127.0.0.1:{port}/"
    print("web_weather — météo orientée orage", flush=True)
    print(f"  adresse : {url}", flush=True)
    if port != args.port:
        print(f"  (le port {args.port} était occupé)", flush=True)
    if not args.local:
        print(f"  réseau  : {GARDE.adresse(adresse_locale(), port)}   (téléphone, autre poste)", flush=True)
        if appairage.ip_tailscale():
            print(f"  tailscale : {GARDE.adresse(appairage.ip_tailscale(), port)}", flush=True)
        print("            l'autre appareil demande une fois le code d'appairage ci-dessous", flush=True)
        GARDE.annoncer()
    print("  Ctrl+C pour arrêter.\n", flush=True)

    if not args.sans_navigateur:
        webbrowser.open(url)
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur.", flush=True)
    finally:
        serveur.server_close()
    attendre()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
