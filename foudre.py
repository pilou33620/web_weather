"""Impacts de foudre en temps réel : flux websocket public de Blitzortung.org.

Bibliothèque standard seulement : un client websocket minimal (RFC 6455, client
vers serveur, trames texte), le décodage LZW des trames Blitzortung, et un tampon
des impacts des deux dernières heures, pour le monde entier (environ 200/min,
quelques Mo). Le serveur filtre par distance à chaque requête de la page.

Protocole non documenté officiellement (repris de clients open source) : se
connecter, envoyer {"a":111}, recevoir des trames JSON compressées en LZW.
Conditions : usage non commercial, données CC BY-SA 4.0, source citée, relais
par notre serveur (jamais depuis le navigateur).

    python foudre.py          contrôles hors réseau (affiche OK)
    python foudre.py --direct écoute le vrai flux 30 s et donne un bilan
"""
import base64
import collections
import json
import math
import os
import socket
import ssl
import struct
import sys
import threading
import time

HOTES = ("ws1.blitzortung.org", "ws7.blitzortung.org", "ws8.blitzortung.org")
DUREE_TAMPON = 2 * 3600        # secondes d'impacts gardés
TRAME_MAX = 1 << 20            # une trame Blitzortung fait quelques centaines d'octets


def decoder_lzw(texte):
    """Décompresse une trame Blitzortung (LZW sur les caractères, dictionnaire à partir de 256)."""
    if not texte:
        return ""
    dico, courant = {}, texte[0]
    precedent, sortie, code = courant, [courant], 256
    for car in texte[1:]:
        n = ord(car)
        if n < 256:
            mot = car
        elif n in dico:
            mot = dico[n]
        else:
            mot = precedent + courant
        sortie.append(mot)
        courant = mot[0]
        dico[code] = precedent + courant
        code += 1
        precedent = mot
    return "".join(sortie)


def impact(texte):
    """(temps en ms, lat, lon) d'une trame décodée, ou None si elle est illisible."""
    try:
        d = json.loads(decoder_lzw(texte))
        lat, lon = float(d["lat"]), float(d["lon"])
        t = int(d["time"]) // 1_000_000           # ns -> ms
    except (ValueError, KeyError, TypeError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return t, lat, lon


def distance_km(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    a = (math.sin((lat2 - lat1) * r / 2) ** 2
         + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(1.0, a)))


# --- Websocket minimal ---------------------------------------------------------

def trame_client(donnees, opcode=1):
    """Trame client -> serveur : toujours masquée (RFC 6455 §5.3)."""
    masque = os.urandom(4)
    n = len(donnees)
    tete = bytes([0x80 | opcode])
    if n < 126:
        tete += bytes([0x80 | n])
    elif n < 65536:
        tete += bytes([0x80 | 126]) + struct.pack("!H", n)
    else:
        tete += bytes([0x80 | 127]) + struct.pack("!Q", n)
    return tete + masque + bytes(b ^ masque[i % 4] for i, b in enumerate(donnees))


def lire_exact(lire, n):
    morceaux = []
    while n:
        bloc = lire(n)
        if not bloc:
            raise ConnectionError("connexion fermée")
        morceaux.append(bloc)
        n -= len(bloc)
    return b"".join(morceaux)


def lire_trame(lire):
    """(fin, opcode, données) de la trame suivante du serveur."""
    a, b = lire_exact(lire, 2)
    n = b & 0x7F
    if n == 126:
        n = struct.unpack("!H", lire_exact(lire, 2))[0]
    elif n == 127:
        n = struct.unpack("!Q", lire_exact(lire, 8))[0]
    if n > TRAME_MAX:
        raise ConnectionError("trame trop grande")
    masque = lire_exact(lire, 4) if b & 0x80 else None
    donnees = lire_exact(lire, n)
    if masque:
        donnees = bytes(x ^ masque[i % 4] for i, x in enumerate(donnees))
    return bool(a & 0x80), a & 0x0F, donnees


def messages(sock):
    """Les messages texte du serveur ; répond aux ping, s'arrête sur close."""
    lire = sock.makefile("rb").read
    morceaux = []
    while True:
        fin, op, donnees = lire_trame(lire)
        if op == 9:                                   # ping -> pong
            sock.sendall(trame_client(donnees, 10))
        elif op == 8:
            return
        elif op in (0, 1, 2):
            morceaux.append(donnees)
            if fin:
                message, morceaux = b"".join(morceaux), []
                yield message.decode("utf-8", "replace")


def ouvrir(hote, delai=15):
    brut = socket.create_connection((hote, 443), timeout=delai)
    sock = ssl.create_default_context().wrap_socket(brut, server_hostname=hote)
    cle = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(("GET / HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n"
                  "Origin: https://map.blitzortung.org\r\n"
                  "User-Agent: web_weather (+https://github.com/pilou33620/web_weather)\r\n\r\n"
                  % (hote, cle)).encode())
    reponse = b""
    while b"\r\n\r\n" not in reponse:
        bloc = sock.recv(4096)
        if not bloc or len(reponse) > 16384:
            raise ConnectionError("poignée de main websocket refusée")
        reponse += bloc
    if b" 101 " not in reponse.split(b"\r\n", 1)[0]:
        raise ConnectionError(reponse.split(b"\r\n", 1)[0].decode("latin-1"))
    # shortcut: les octets reçus après l'en-tête 101 sont perdus ; le serveur n'envoie rien avant {"a":111}
    sock.sendall(trame_client(b'{"a":111}'))
    return sock


# --- Tampon et connexion permanente --------------------------------------------

class Foudre:
    """Garde les impacts des deux dernières heures ; se reconnecte seul."""

    def __init__(self):
        self.impacts = collections.deque()
        self.verrou = threading.Lock()
        self.connecte = False
        self.derniere = 0.0          # heure de la dernière trame reçue
        self.erreur = ""

    def ajouter(self, imp, maintenant_ms=None):
        maintenant_ms = maintenant_ms or time.time() * 1000
        with self.verrou:
            self.impacts.append(imp)
            limite = maintenant_ms - DUREE_TAMPON * 1000
            while self.impacts and self.impacts[0][0] < limite:
                self.impacts.popleft()

    def autour(self, lat, lon, rayon_km, maintenant_ms=None):
        maintenant_ms = maintenant_ms or time.time() * 1000
        limite = maintenant_ms - DUREE_TAMPON * 1000
        with self.verrou:
            copie = list(self.impacts)
        # Cadre grossier d'abord : la distance exacte ne se calcule que pour les proches
        dlat = rayon_km / 111.0
        dlon = rayon_km / (111.0 * max(0.1, math.cos(math.radians(lat))))
        return [i for i in copie
                if i[0] >= limite and abs(i[1] - lat) <= dlat and abs(i[2] - lon) <= dlon
                and distance_km(lat, lon, i[1], i[2]) <= rayon_km]

    def etat(self):
        return {"connecte": self.connecte, "derniere_trame_s": round(time.time() - self.derniere) if self.derniere else None,
                "erreur": self.erreur, "tampon": len(self.impacts)}

    def tourner(self):
        """Boucle sans fin (fil d'arrière-plan) : un hôte après l'autre, pause croissante."""
        pause, n = 5, 0
        while True:
            hote = HOTES[n % len(HOTES)]
            try:
                sock = ouvrir(hote)
                sock.settimeout(60)              # plus d'une minute sans trame : on change d'hôte
                self.connecte, self.erreur = True, ""
                with sock:
                    for message in messages(sock):
                        imp = impact(message)
                        # Pause remise à zéro sur une vraie trame : un serveur qui accepte puis
                        # ferme aussitôt ne nous fait pas reconnecter toutes les 5 s
                        self.derniere, pause = time.time(), 5
                        if imp:
                            self.ajouter(imp)
            except (OSError, ConnectionError, ValueError) as exc:
                self.erreur = "%s : %s" % (hote, exc)
            self.connecte = False
            n += 1
            time.sleep(pause)
            pause = min(pause * 2, 300)

    def demarrer(self):
        threading.Thread(target=self.tourner, name="foudre", daemon=True).start()
        return self


def _controles():
    def lzw(texte):   # compresseur de référence, pour vérifier le décodeur
        dico, w, out, code = {chr(i): i for i in range(256)}, "", [], 256
        for c in texte:
            if w + c in dico:
                w += c
            else:
                out.append(dico[w])
                dico[w + c], code, w = code, code + 1, c
        if w:
            out.append(dico[w])
        return "".join(chr(c) for c in out)

    trame = json.dumps({"time": 1793209800123456789, "lat": 44.8, "lon": -0.63, "alt": 0, "pol": 0,
                        "sig": [{"sta": 1, "time": 1, "lat": 44.8, "lon": -0.6}] * 5})
    assert decoder_lzw(lzw(trame)) == trame
    assert decoder_lzw(lzw("abababababab")) == "abababababab"       # cas « code pas encore au dico »
    assert impact(lzw(trame)) == (1793209800123, 44.8, -0.63)
    assert impact("pas du json") is None
    assert impact(lzw('{"time": 1, "lat": 95, "lon": 0}')) is None

    # Trames : aller (masquée) puis relecture
    for taille in (5, 300, 70000):
        brut = trame_client(b"x" * taille)
        fin, op, donnees = lire_trame(__import__("io").BytesIO(brut).read)
        assert (fin, op, donnees) == (True, 1, b"x" * taille)
    try:
        lire_trame(__import__("io").BytesIO(b"\x81\x7f" + struct.pack("!Q", 1 << 40)).read)
        raise AssertionError("trame géante acceptée")
    except ConnectionError:
        pass

    class FauxSocket:
        def __init__(self, brut):
            self.brut, self.envoye = brut, []
        def makefile(self, _mode):
            return __import__("io").BytesIO(self.brut)
        def sendall(self, donnees):
            self.envoye.append(donnees)
    serveur_vers = lambda op, d, fin=True: bytes([(0x80 if fin else 0) | op, len(d)]) + d
    s = FauxSocket(serveur_vers(9, b"p") + serveur_vers(1, b"bon", False) + serveur_vers(0, b"jour")
                   + serveur_vers(8, b"") + serveur_vers(1, b"jamais lu"))
    assert list(messages(s)) == ["bonjour"]
    assert len(s.envoye) == 1 and s.envoye[0][0] == 0x8A          # un pong, rien d'autre

    f, t0 = Foudre(), 10_000_000_000
    f.ajouter((t0 - 3 * 3600 * 1000, 44.8, -0.6), t0)
    f.ajouter((t0 - 60_000, 44.9, -0.6), t0)          # 11 km
    f.ajouter((t0 - 60_000, 48.85, 2.35), t0)         # Paris, 500 km
    assert len(f.impacts) == 2                        # le vieil impact est sorti
    assert [i[1] for i in f.autour(44.8, -0.63, 300, t0)] == [44.9]
    assert abs(distance_km(0, 0, 1, 0) - 111.19) < 0.1
    print("OK : foudre (LZW, trames, ping, fragments, tampon)")


def _direct(duree=30):
    f = Foudre().demarrer()
    time.sleep(duree)
    with f.verrou:
        imps = list(f.impacts)
    retards = sorted(time.time() * 1000 - i[0] for i in imps)
    print("état :", f.etat())
    print("%d impacts en %d s ; retard médian %s s" % (len(imps), duree,
          round(retards[len(retards) // 2] / 1000, 1) if retards else "–"))


if __name__ == "__main__":
    _direct() if "--direct" in sys.argv else _controles()
