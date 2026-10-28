"""Banc du serveur : ce qu'il sert, ce qu'il refuse, sans réseau.

    python test/banc-serveur.py

Démarre le serveur en mémoire sur un port libre de 127.0.0.1. Les sources
externes (Open-Meteo, RainViewer, OSM) sont remplacées par de fausses réponses.
"""
import http.client
import json
import os
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE)
import serveur  # noqa: E402

# --- Fausses sources ---------------------------------------------------------
APPELS = []
maintenant = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
HEURES = [(maintenant + timedelta(hours=k)).strftime("%Y-%m-%dT%H:00") for k in range(-3, 45)]
RADAR = {"host": "https://tiles.exemple", "radar": {"past": [{"time": 1793209800, "path": "/v2/radar/abc"}]}}
PANNE = set()


def faux_telecharger(url, max_octets=8 << 20):
    APPELS.append(url)
    if any(p in url for p in PANNE):
        raise serveur.ErreurSource("source.exemple : HTTP 429")
    if url.startswith(serveur.RAINVIEWER):
        return json.dumps(RADAR).encode()
    if url.endswith(".png"):
        return b"PNG:" + url.encode()
    if "models=icon_d2" in url:
        return json.dumps({"hourly": {"time": HEURES[:3], "lightning_potential": [0, 1.5, None]}}).encode()
    if "latitude=" in url and "%2C" in url:                     # grille : une réponse par point
        n = url.split("latitude=")[1].split("&")[0].count("%2C") + 1
        return json.dumps([{"utc_offset_seconds": 0, "hourly": {"time": HEURES, "cape": [float(p)] * len(HEURES)}}
                           for p in range(n)]).encode()
    if "geocoding" in url:
        return json.dumps({"results": [{"name": "<b>Pessac</b>", "admin1": "Nouvelle-Aquitaine", "country": "France",
                                        "latitude": 44.8, "longitude": -0.63}]}).encode()
    return json.dumps({"current": {"time": HEURES[3]}, "hourly": {"time": HEURES}}).encode()


serveur.telecharger = faux_telecharger
serveur.Gestionnaire.log_message = lambda *a: None      # bilan court seulement
tmp = tempfile.TemporaryDirectory()
serveur.CACHE_DISQUE = tmp.name

srv = serveur.Serveur(("127.0.0.1", 0), serveur.Gestionnaire)
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]


def requete(chemin, hote=None, methode="GET"):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    c.putrequest(methode, chemin, skip_host=True)
    c.putheader("Host", hote or "127.0.0.1:%d" % PORT)
    c.endheaders()
    r = c.getresponse()
    corps = r.read()
    c.close()
    return r.status, corps, r


essais = echecs = 0


def verifier(nom, obtenu, attendu):
    global essais, echecs
    essais += 1
    if obtenu != attendu:
        echecs += 1
        print("ECHEC %s : attendu %r, obtenu %r" % (nom, attendu, obtenu))


# --- Fichiers servis et refusés ---------------------------------------------
for chemin, attendu in [
    ("/", 200), ("/index.html", 200), ("/css/style.css", 200), ("/js/app.js", 200), ("/js/calc.js", 200),
    ("/vendor/leaflet/leaflet.js", 200), ("/vendor/leaflet/leaflet.css", 200), ("/favicon.ico", 204),
    ("/.git/config", 404), ("/.gitignore", 404), ("/serveur.py", 404), ("/foudre.py", 404),
    ("/appairage.py", 404), ("/SPEC.md", 404), ("/js/", 404), ("/js/../serveur.py", 404),
    ("/js/%2e%2e/serveur.py", 404), ("/cache/osm/1/0/0.png", 404), ("/test/banc-serveur.py", 404),
    ("/C:%5cWindows%5cwin.ini", 404), ("/api/inconnue", 404),
]:
    verifier("GET " + chemin, requete(chemin)[0], attendu)
verifier("HEAD /.git/config", requete("/.git/config", methode="HEAD")[0], 404)
verifier("Host étranger", requete("/", "evil.example:8792")[0], 403)
verifier("Host étranger sur l'API", requete("/api/radar", "evil.example:8792")[0], 403)
verifier("Host IP locale", requete("/", "192.168.1.20:8792")[0], 200)
verifier("POST : aucune route n'écrit", requete("/api/meteo", methode="POST")[0], 501)
_, _, r = requete("/")
verifier("en-têtes", (r.getheader("X-Frame-Options"), r.getheader("X-Content-Type-Options"),
                      "frame-ancestors 'self'" in (r.getheader("Content-Security-Policy") or "")),
         ("SAMEORIGIN", "nosniff", True))

# --- API : paramètres -------------------------------------------------------
for q in ("", "lat=abc&lon=1", "lat=91&lon=0", "lat=0&lon=181", "lat=nan&lon=0", "lat=inf&lon=0"):
    verifier("paramètres refusés : " + q, requete("/api/meteo?" + q)[0], 400)
verifier("lieu trop court", requete("/api/lieux?q=a")[0], 400)

# --- API : relais et cache --------------------------------------------------
statut, corps, _ = requete("/api/meteo?lat=44.80565&lon=-0.6324")
m = json.loads(corps)
verifier("météo + LPI", (statut, m["lpi"]["valeurs"]), (200, [0, 1.5, None]))
avant = len(APPELS)
requete("/api/meteo?lat=44.8061&lon=-0.6319")                  # même lieu une fois arrondi
verifier("météo : cache par lieu arrondi", len(APPELS), avant)

statut, corps, _ = requete("/api/grille?lat=44.8&lon=-0.63")
g = json.loads(corps)
verifier("grille 15×15", (statut, len(g["lats"]), len(g["lons"]), len(g["cape"][0])), (200, 15, 15, 225))
verifier("grille : 24 h à partir de l'heure en cours", (len(g["time"]), g["time"][0]), (24, HEURES[3]))
verifier("grille : un seul appel pour 225 points", sum("hourly=cape" in u for u in APPELS), 1)
verifier("grille : point i, j", g["cape"][0][16], 16.0)

statut, corps, _ = requete("/api/lieux?q=Pessac")
verifier("lieux", (statut, json.loads(corps)[0]["nom"]), (200, "<b>Pessac</b>"))   # échappé par la page

PANNE.add("ensemble-api")
statut, corps, _ = requete("/api/ensemble?lat=1&lon=1")
verifier("source en panne : 502 court", (statut, json.loads(corps)["detail"]), (502, "source.exemple : HTTP 429"))
PANNE.clear()
verifier("une erreur ne reste pas en cache", requete("/api/ensemble?lat=1&lon=1")[0], 200)

_vrai = serveur.telecharger
serveur.telecharger = lambda url, m=0: b"<html>erreur</html>"
statut, corps, _ = requete("/api/modeles?lat=2&lon=2")
verifier("source illisible : 502", (statut, json.loads(corps)["detail"]), (502, "api.open-meteo.com : réponse illisible"))
serveur.telecharger = lambda url, m=0: b"[]"
verifier("source au format inattendu : 502", requete("/api/grille?lat=3&lon=3")[0], 502)
serveur.telecharger = _vrai

# Deux demandes simultanées de la même clé : un seul calcul
import time  # noqa: E402
calculs = []
lent = lambda: calculs.append(1) or time.sleep(0.3) or "valeur"
fils = [threading.Thread(target=serveur.en_cache, args=(("essai",), 60, lent)) for _ in range(2)]
for t in fils: t.start()
for t in fils: t.join()
verifier("cache : un seul calcul pour deux demandes simultanées", len(calculs), 1)

statut, corps, _ = requete("/api/foudre?lat=44.8&lon=-0.63")
f = json.loads(corps)
verifier("foudre : réponse", (statut, f["impacts"], f["etat"]["connecte"]), (200, [], False))

# --- Tuiles -------------------------------------------------------------------
verifier("radar : liste", json.loads(requete("/api/radar")[1]), {"images": [1793209800], "zoom_max": 7})
statut, corps, _ = requete("/tuiles/radar/1793209800/6/31/22.png")
verifier("radar : tuile relayée", (statut, corps), (200, b"PNG:https://tiles.exemple/v2/radar/abc/256/6/31/22/2/1_1.png"))
verifier("radar : heure absente de la liste", requete("/tuiles/radar/1793209000/6/31/22.png")[0], 404)
verifier("radar : zoom > 7", requete("/tuiles/radar/1793209800/8/31/22.png")[0], 404)
verifier("radar : x hors de la carte", requete("/tuiles/radar/1793209800/2/4/0.png")[0], 404)
verifier("tuile : chemin bizarre", requete("/tuiles/osm/../../serveur.py")[0], 404)

statut, corps, _ = requete("/tuiles/osm/7/63/45.png")
verifier("osm : tuile relayée", (statut, corps), (200, b"PNG:https://tile.openstreetmap.org/7/63/45.png"))
verifier("osm : rangée sur disque", os.path.isfile(os.path.join(tmp.name, "osm", "7", "63", "45.png")), True)
avant = len(APPELS)
requete("/tuiles/osm/7/63/45.png")
verifier("osm : relue depuis le disque", len(APPELS), avant)
os.utime(os.path.join(tmp.name, "osm", "7", "63", "45.png"), (0, 0))   # périmée
PANNE.add("openstreetmap")
verifier("osm : périmée mais OSM en panne, servie quand même", requete("/tuiles/osm/7/63/45.png")[0], 200)
verifier("osm : absente et OSM en panne", requete("/tuiles/osm/7/63/46.png")[0], 502)
PANNE.clear()
verifier("osm : zoom > 13", requete("/tuiles/osm/14/0/0.png")[0], 404)

srv.shutdown()
tmp.cleanup()
print("%d/%d ok" % (essais - echecs, essais))
sys.exit(1 if echecs else 0)
