# web_weather

Météo orientée orage, pensée pour le téléphone. Lieu par défaut : Pessac (33).

Interface claire façon iOS : barre du haut (position, lieu, alertes, recherche), menu flottant en bas.

- **Accueil** : conditions actuelles, accès aux analyses, activité électrique réelle (orage actif proche, activité régionale), alertes probables (orage, pluies fortes, rafales, foudre) avec « dans N heures », prochaines heures, 10 jours.
  - **Graphiques** : 24 h / 48 h / 72 h / 7 j, modèles à comparer, analyse orageuse (jauge, heures les plus à risque), température, pluie et probabilité, vent, nuages par étage.
  - **Analyse orage pro** : pic prévu, type d'orage, discussion technique, risques (grêle, vent, tornade, foudre), indices K, TT, SCP, STP, EHI, LCL, cisaillements, SRH (approchée).
  - **Convection HD** : AROME-HD par quart d'heure sur 12 h (pluie, CAPE, rafales, LPI).
  - **Modèles**, **Fiabilité** (Ensemble ICON 40 membres), **Brief météo** (synthèse par thème, confiance, sources).
- **Chasse orage** : carte avec radar (RainViewer), impacts de foudre en temps réel (Blitzortung), cellules, distance, rayon d'alerte, alerte d'approche, couches vent et CAPE prévues.
- **Station** : valeurs du point et tableau 24 h. **Vigilance** : officielle Météo-France si la clé est posée, sinon indicative. **Autre** : suivi de position, notifications, seuils, état des sources.
- **Cloche** : alertes en cours ; notifications du navigateur quand un orage est proche (appli ouverte ou en arrière-plan).

Le score, les alertes et la Vigilance sont des heuristiques (voir `SPEC.md` §4 bis), jamais des prévisions officielles.

## Sources

Le navigateur ne parle qu'au serveur, qui relaie et garde en cache :

| Source | Usage | Cache |
|---|---|---|
| [Open-Meteo](https://open-meteo.com) (CC BY 4.0) | prévisions, LPI ICON-D2, modèles, Ensemble, grille CAPE, recherche de lieux | 10 min à 1 jour |
| [RainViewer](https://www.rainviewer.com) | radar de pluie (zoom 7 au plus) | liste 2 min, tuiles 2 h |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | fond de carte, assombri par la page | disque, 7 jours (`cache/`) |
| [Blitzortung.org](https://www.blitzortung.org) (CC BY-SA 4.0) | impacts de foudre, websocket permanent | mémoire, 2 h |
| [Météo-France](https://portail-api.meteofrance.fr) | vigilance officielle par département (clé nécessaire) | 10 min |
| [API Adresse](https://adresse.data.gouv.fr) (Licence ouverte) | commune et département d'une position (arrondie à 1 km) | 30 jours |

Budget Open-Meteo : environ 5 400 appels par jour pour la grille d'un lieu (225 points par heure), sur un quota gratuit de 10 000.

## Installation

Python 3.8 ou plus, bibliothèque standard seulement (aucun `pip install`).

```sh
git clone https://github.com/pilou33620/web_weather.git
cd web_weather
python3 serveur.py
```

Windows : double-clic sur `serveur.py`. Termux : `pkg install python git openssl`, puis la même commande.

## Options

| Option | Rôle |
|---|---|
| `--port N` | port d'écoute (8792 par défaut ; le suivant libre s'il est pris) |
| `--local` | n'écouter que sur `127.0.0.1` (pas d'appairage) |
| `--sans-navigateur` | ne pas ouvrir le navigateur |
| `--sans-pause` | ne pas attendre une touche à l'arrêt |
| `--sans-maj` | ne pas vérifier les mises à jour au démarrage |

## Vigilance officielle Météo-France

1. Créer un compte sur [portail-api.meteofrance.fr](https://portail-api.meteofrance.fr) et s'abonner à « Données Publiques Vigilance ».
2. Générer une clé d'API et la coller seule dans `~/.web_tools/meteofrance-cle.txt` (`chmod 600`). Elle n'est jamais dans git ni dans les journaux.
3. Rien à redémarrer : la clé est relue à chaque appel. Sans clé ou si elle est refusée, la page affiche la vigilance indicative et la raison.

## Utiliser depuis un autre appareil

La position automatique et les notifications exigent le HTTPS : utiliser l'adresse **Réseau** (pas `http://` en clair). Sur iPhone, « Sur l'écran d'accueil » permet les notifications.

Sans `--local`, le serveur écoute sur le réseau local et sur Tailscale, et affiche l'adresse **Réseau** et un **code d'appairage** à 6 chiffres. Ouvrir cette adresse sur le téléphone puis entrer le code une fois. L'appairage, le jeton et le HTTPS local sont communs à tous les web tools (`appairage.py`, copie de `web_suite/lanceur/appairage.py`). Pour éviter l'alerte du navigateur, installer l'autorité locale proposée sur `/appairage/ca.pem`. Ne jamais exposer le port sur Internet.

## web_launcher

Entrée à ajouter dans `web_launcher/outils.json` :

```json
{
  "id": "web_weather",
  "nom": "Web",
  "suffixe": "Weather",
  "description": "Météo orientée orage : radar, foudre en direct, risque d'orage",
  "accent": "#2b8cff",
  "icone": "suite",
  "depot": "https://github.com/pilou33620/web_weather.git",
  "dossiers": ["web_weather"],
  "port": 8792,
  "commande": ["{python}", "serveur.py", "--port", "{port}", "--sans-navigateur", "--sans-pause", "--sans-maj"],
  "delai_arret": 15
}
```

## Mises à jour

Au démarrage (sauf `--sans-maj`) : `git fetch` (10 s au plus), puis `git pull --ff-only` s'il y a du nouveau, puis redémarrage. Des fichiers suivis modifiés localement sont mis de côté (`git stash`) puis réappliqués. Sous web_launcher, c'est le launcher qui met à jour.

## Données

Aucune donnée personnelle côté serveur. Le cache des tuiles OSM est dans `cache/` (ignoré par git, à supprimer sans risque). Les réglages restent dans le navigateur.

## Bancs d'essai

Chaque banc n'affiche qu'un bilan court, sans réseau :

```sh
python3 test/banc-serveur.py   # fichiers servis, Host, API, tuiles, cache
python3 foudre.py              # LZW, trames websocket, tampon des impacts
node test/test_calc.js         # score, alertes, vigilance, ensemble, impacts
python3 appairage.py           # appairage commun
```

`node test/rendu_pages.js http://127.0.0.1:8893` rend chaque page dans un faux DOM avec les vraies réponses d'un serveur lancé à part (`python3 serveur.py --local --sans-maj --sans-navigateur --port 8893`) : erreurs, « undefined », « NaN ».

`python3 foudre.py --direct` écoute le vrai flux Blitzortung pendant 30 s et donne un bilan.
