# web_weather : spécification (v2.0)

Statut : version 2 (refonte claire façon iOS d'après les captures de référence du 2026-10-28). Mode d'emploi : `README.md`. Partie serveur : `~/Documents/REGLES-NOUVEAU-WEB-TOOL.md` (section 5).

## 1. Objectif

Application météo orientée orage, proche des captures de référence (accueil, Chasse orage, Station, Vigilance, Autre).
Serveur Python + front HTML/CSS/JS, sans framework JS.

## 2. Contrainte de sources

**Open-Meteo est la seule source de données météo** (https://github.com/open-meteo/open-meteo).
Conséquence : pas de radar, pas de Vigilance officielle, pas de capteurs de station, et pas d'impacts de foudre en direct dans Open-Meteo.
Chaque écran de la capture est donc remplacé par un équivalent calculé à partir d'Open-Meteo (section 4).
Exceptions : le fond de carte OpenStreetMap (section 4 bis), la foudre en temps réel (section 2 bis, Blitzortung, en test) et le radar de pluie (section 2 ter, RainViewer, retenu).

### 2 bis. Foudre en temps réel : source externe (Blitzortung, à confirmer)

Open-Meteo n'a pas d'impacts réels (section 3). Source candidate pour la carte, le compteur et l'alerte d'approche : le flux websocket public de Blitzortung.org.
- Protocole : se connecter à `wss://ws1.blitzortung.org/` (secours : ws7, ws8), envoyer `{"a":111}`, recevoir des trames JSON compressées en LZW. Non documenté officiellement ; décodage tiré de clients open source (par exemple simonsorcerer23/ft8-raspi).
- Test du 2026-10-28 (25 s, une connexion) : 87 éclairs reçus (environ 204/min), 0 trame illisible, retard médian 5 s (1,6 à 22,7 s). Champs : `time` (ns), `lat`, `lon`, `alt`, `pol`, `mds`, `mcg`, `sig`, `region`, `status`, `delay`.
- Client côté serveur : **websocket minimal écrit en bibliothèque standard** (socket + ssl + trames, décodage LZW), avec un banc d'essai sur des trames enregistrées. Pas de dépendance (règle « stdlib seule »).
- Le flux est **mondial** : le serveur Python doit filtrer par zone (cadre autour de la position). Aucun éclair en France pendant le test (peut-être simplement pas d'orage à ce moment), donc la couverture France n'est pas démontrée.
- Conditions (forums, anciennes et contradictoires) : usage non commercial, gratuit, source indiquée (données CC-BY-SA 4.0), données relayées depuis **notre serveur** et pas depuis le navigateur. À confirmer auprès de Blitzortung.
- Risque : service non garanti, protocole non documenté, il peut changer.
- Repli possible : EUMETSAT MTG Lightning Imager (satellite, latence sous 15 min, conditions d'accès non confirmées).

### 2 ter. Radar de pluie : RainViewer (retenu)

Open-Meteo n'a pas de radar. **Source retenue : RainViewer.** Aucune source gratuite n'est en « live » au sens strict (images par pas de 10 à 15 min). Météo-France et Open-Meteo restent des pistes de repli.
- **RainViewer** (testé le 2026-10-28) : `https://api.rainviewer.com/public/weather-maps.json` répond sans clé. 13 images passées, pas de 10 min, dernière image vieille de 7 min, historique d'environ 2 h. `nowcast` et `satellite` sont vides (supprimés début 2026). Tuiles PNG 256 px téléchargées en z6, z7 et z8 (HTTP 200) ; le chemin des tuiles doit être pris dans la réponse JSON. Conditions annoncées (FAQ de transition, non confirmées par une page officielle récente) : zoom max 7, 100 requêtes par IP et par minute, un seul schéma de couleur, usage personnel ou éducatif, attribution « Weather data by Rain Viewer » avec lien.
- **Météo-France, API Paquet Radar** (non testé) : paquets radar toutes les 15 min, rétention 20 h, compte gratuit sur le portail API. Licence probablement Licence ouverte / Etalab 2.0 (source non officielle, à confirmer). Plus précis sur la France, plus lourd à intégrer (paquets à décoder).
- **Open-Meteo, équivalent le plus proche** (testé le 2026-10-28) : `minutely_15=precipitation` avec `models=meteofrance_arome_france_hd` (ou `meteofrance_arome_france`) renvoie de la pluie par pas de 15 min (16/16 valeurs, passé et futur proche). C'est la sortie d'un modèle de prévision (1,5 km), pas une mesure radar : elle peut se tromper sur la position et l'heure des averses. Une carte exige une grille de points (un appel par point dans le quota) puis une interpolation côté front. Le domaine interne `aromepi` (AROME Prévision Immédiate) existe dans le code mais n'est pas exposé : `meteofrance_aromepi` et `meteofrance_arome_pi` renvoient HTTP 400. Le visualiseur `maps.open-meteo.com` n'a pas d'API de tuiles documentée.
- Le radar affiché sur la capture de référence est une mosaïque colorée par intensité de pluie : RainViewer s'en rapproche le plus avec le moins de travail.

## 3. API Open-Meteo utilisées

| API | Usage |
|---|---|
| Forecast `/v1/forecast` | Heures, 10-16 jours, `current`, 15 min, variables orage, niveaux de pression |
| Ensemble | Probabilités et fiabilité des prévisions |
| Geocoding | Recherche d'une ville (loupe) |
| Historical / Previous Runs | Graphiques du passé, fiabilité (option) |
| Elevation | Altitude du point (option) |

Variables orage : `cape`, `lifted_index`, `convective_inhibition`, `lightning_potential` (15 min), `freezing_level_height`, `wind_gusts_10m`, `precipitation`, `precipitation_probability`, `weather_code`.
Limite vérifiée : `lightning_potential` n'existe que pour le modèle ICON-D2 (Europe centrale), selon la doc.
Couverture du LPI testée le 2026-10-28 (valeurs sur 24 h) : `icon_d2` donne 24/24 à Paris, Lyon, Strasbourg, Lille, Bordeaux et Londres. HTTP 400 (hors domaine) à Marseille, Brest, Perpignan, Madrid, Rome, New York. `best_match` ne choisit pas `icon_d2` à Londres (0/24) : **appeler explicitement `models=icon_d2` pour le LPI**, séparément du reste.
**Foudre en temps réel : introuvable dans Open-Meteo.** Vérifié dans le code source du dépôt (arbre complet, recherche « lightning ») et par appels réels. Aucun module d'observation, de radar ou de réseau de détection : les dossiers de `Sources/App` sont des modèles de prévision (ICON, Météo-France, ECMWF, GFS, UKMO, etc.) et des satellites de rayonnement solaire. Les variables de foudre existantes sont toutes des prévisions :
- `lightning_potential` (LPI) : `icon_d2` (Europe centrale, nord et centre de la France) et `italia_meteo_arpae_icon_2i` (Italie, testé à Marseille et Rome : valeurs présentes, 0 au moment du test) ;
- `lightning_density` (« strikes per 100 km² per hour », ECMWF) : 0 valeur sur tous les points et modèles testés, donc inutilisable en pratique ;
- `lightning_strike_density_{type}` : modèle NCEP RRFS, États-Unis, d'après la doc du dépôt (non testé).
Conséquence : points d'impact, compteur « Flux foudre », cellules et alerte d'approche **réels** sont hors périmètre tant que la source reste Open-Meteo seul. Équivalent faisable : indice de risque de foudre prévu (LPI là où il existe) + CAPE/LI/CIN. À présenter comme une prévision, jamais comme des impacts mesurés.

Règle d'appli : tenter `icon_d2` pour le LPI. En cas de 400 ou de valeurs vides, masquer l'indicateur foudre et baser le score sur CAPE, LI, CIN, rafales, pluie. CAPE est disponible partout.

Endpoints testés (HTTP 200) : forecast `api.open-meteo.com/v1/forecast`, ensemble `ensemble-api.open-meteo.com/v1/ensemble` (paramètre `models` obligatoire), geocoding `geocoding-api.open-meteo.com/v1/search` (`name`, `count` max 100, `language`, `countryCode`), elevation `api.open-meteo.com/v1/elevation`, historical `archive-api.open-meteo.com/v1/archive`, historical forecast `historical-forecast-api.open-meteo.com/v1/forecast`, previous runs `previous-runs-api.open-meteo.com/v1/forecast`, marine `marine-api.open-meteo.com/v1/marine`, air quality `air-quality-api.open-meteo.com/v1/air-quality`.

Multi-coordonnées : `latitude=a,b,c&longitude=x,y,z`, réponse = liste. Pas de plafond de points documenté. Mesuré : 500 points OK, 800 points = HTTP 414 (URL trop longue, environ 8 000 caractères). Les 600 et 700 points n'ont pas pu être testés (429). Chaque point semble compter comme un appel dans le quota (déduit de mes tests, non documenté).
Quotas gratuits : 600 appels/min, 5 000/h, 10 000/jour. Une grille de N points coûte donc environ N appels : à cacher fortement.
Vérifié : Open-Meteo ne fournit ni radar mesuré ni impacts de foudre, seulement des prévisions de modèle.
Modèles : `best_match` par défaut, AROME/ARPEGE (France), ICON, IFS, GFS au choix pour l'écran « Modèles ».

## 4. Écrans

| Écran capture | Équivalent Open-Meteo |
|---|---|
| Accueil : conditions actuelles, Prochaines heures, Sur 10 jours | `current`, `hourly`, `daily` (min/max, pluie, UV, lever/coucher, rafales) |
| Accueil : Prochaines alertes probables | Calcul serveur sur `hourly` : fenêtres où CAPE, LI, pluie, rafales dépassent des seuils (niveau « Surveillance ») |
| Accueil : Graphiques, Modèles, Fiabilité, Brief météo | Courbes `hourly`, comparaison multi-modèles, dispersion Ensemble, texte généré |
| Chasse orage : fond radar de pluie | Tuiles RainViewer (section 2 ter), animation sur les images passées, attribution obligatoire |
| Chasse orage : carte | Grille de points (appels multi-coordonnées) colorée par CAPE, LI ou potentiel de foudre, avec curseur temporel |
| Chasse orage : « Flux foudre » (points par ancienneté, compteur, distance, alerte d'approche) | Impacts réels via Blitzortung (section 2 bis, à confirmer). Complément : `lightning_potential` là où il existe (prévision, pas des impacts) |
| Chasse orage : « Risque faible 24 % » | Score serveur combinant CAPE, LI, CIN, potentiel de foudre, probabilité de pluie |
| Station | Valeurs `current` du point, par modèle (pas de capteur réel) |
| Vigilance | Niveaux **indicatifs** calculés par nos seuils. Ce n'est pas la vigilance officielle |
| Autre | Réglages : lieu, unités, modèle, seuils |

## 4 bis. Score de risque et alertes « Surveillance »

Heuristiques (pas un modèle validé), à afficher comme telles, seuils réglables dans « Autre ».
- Score 0-100, par heure. `clamp(x) = min(max(x, 0), 1)`.
  - Sans LPI (hors domaine ICON-D2) : CAPE `45·clamp(cape/2000)` + LI `25·clamp(-li/6)` + pluie `20·pop/100` + rafales `10·clamp((rafale-40)/60)`.
  - Avec LPI : CAPE 36 + LI 20 + pluie 16 + rafales 8 + LPI `20·clamp(lpi/5)` (5 J/kg = plein, à calibrer).
  - Si CIN > 150 J/kg : la part convective (CAPE + LI) est multipliée par 0,6.
  - Niveaux : < 25 Faible, < 50 Modéré, < 75 Élevé, sinon Très élevé.
- Fenêtres d'alerte (heures consécutives) : « Orage probable » si CAPE ≥ 500 et LI ≤ -1 ; « Rafales fortes » si rafales ≥ 60 km/h ; « Foudre probable » si LPI ≥ 2 J/kg (seulement là où le LPI existe).
- Pessac est en bord de domaine ICON-D2 (Bordeaux 24/24 au test) : tester le point exact, et repasser à la formule sans LPI si l'appel échoue.

## 4 ter. Carte CAPE

Grille 15×15 sur environ 150 km autour du lieu (pas d'environ 10 km), mise à jour toutes les heures : 225 × 24 = 5 400 appels/jour sur 10 000. Un seul appel multi-coordonnées par mise à jour (225 points, sous la limite de 500). Cache serveur obligatoire, partagé par tous les clients.

## 4 quater. Fond de carte

Tuiles OpenStreetMap, **relayées et cachées par notre serveur** (User-Agent identifiable, attribution « © OpenStreetMap contributors »), assombries côté page par un filtre CSS (invert + hue-rotate) appliqué au seul calque de fond. Esri et CARTO sont écartés.

## 5. Serveur Python

Référence : `~/Documents/REGLES-NOUVEAU-WEB-TOOL.md`, appliqué tel quel :
- Bibliothèque standard Python seule (`http.server`, `ThreadingTCPServer`), `serveur.py` avec les options standard (`--port`, `--local`, `--sans-navigateur`, `--sans-pause`, `--sans-maj`).
- `appairage.py` copié de `web_suite/lanceur/appairage.py` sans modification (jeton, code d'appairage, HTTPS).
- Fichiers statiques par liste blanche (regex), aucun CORS ouvert, mise à jour automatique git, intégration web_launcher (entrée `outils.json`), banc `test/banc-serveur.py` et CI.
- Port : 8792 proposé (premier libre de la plage 8790-8899 d'après les règles, à confirmer dans le catalogue du launcher).
- Rôle : **toutes les sources externes passent par le serveur**, le navigateur ne parle qu'à lui (plus de CORS ni de CSP à ouvrir) :
  - proxy et cache Open-Meteo (point du lieu, LPI `icon_d2` séparé, grille CAPE horaire) ;
  - relais et cache des tuiles RainViewer et OpenStreetMap ;
  - connexion websocket Blitzortung, filtrage par zone, impacts récents servis à la page ;
  - le score, les alertes et la Vigilance se calculent **dans la page** (`js/calc.js`), car les seuils sont des réglages de chaque appareil.
- Pas de route qui écrit : aucune donnée côté serveur, hors cache. Réglages dans le navigateur.

## 6. Contraintes

- Licence des données CC BY 4.0 : afficher « Weather data by Open-Meteo.com » avec lien.
- Usage non commercial gratuit, sans clé. Fair use : un cache serveur est obligatoire pour la grille de la carte.
- Au-delà de 10 000 requêtes/jour il faut contacter Open-Meteo.
- Les seuils d'alerte et le score de risque sont des heuristiques, à afficher comme tels.

## 7. Décisions prises

- Périmètre : tous les écrans de la capture (accueil et alertes, Chasse orage, Station, Vigilance, Autre), avec Open-Meteo comme source météo.
- Foudre : l'utilisateur veut les impacts réels en temps réel. Il veut les trois usages : points sur la carte, compteur et distance, alerte d'approche. Source retenue pour test : Blitzortung (section 2 bis).
- Radar : RainViewer retenu (section 2 ter). Vigilance officielle : pas de source ajoutée.
- Fond de carte : OpenStreetMap relayé par le serveur, assombri en CSS (section 4 quater).
- Grille CAPE : 15×15, ~150 km, horaire (section 4 ter).
- Score : heuristique de la maquette, plus le LPI à 20 points quand il existe, plus l'alerte « Foudre probable » (section 4 bis).
- Interface : français uniquement, °C, km/h, mm, mobile d'abord (le bureau s'adapte simplement).
- Serveur : `REGLES-NOUVEAU-WEB-TOOL.md`, client websocket Blitzortung en stdlib (section 5).
- Écrans finaux : Accueil (avec brief), Chasse orage (radar, foudre, cellules, grille CAPE), Données (station, graphiques, modèles, fiabilité), Vigilance indicative, Réglages.
- Vigilance indicative : jaune / orange / rouge à 25 / 50 / 75 % de score d'orage, 70 / 90 / 110 km/h de rafales, 20 / 40 / 80 mm de pluie par jour.
- Historique : une maquette jetable a existé dans `maquette/` (supprimée en v1, voir l'historique git) (lieu : Pessac 33, HTML/CSS/JS, Leaflet) : météo Open-Meteo et radar RainViewer réels, impacts de foudre **simulés**, fond de carte Esri « Dark Gray » (CARTO sombre testé puis écarté : filigrane « API key required », il exige maintenant une clé). Elle appelle les API directement depuis le navigateur ; le vrai produit passera par le serveur Python.

## 8. Non vérifié

- Politique d'usage des tuiles OpenStreetMap (tile.openstreetmap.org) : à relire avant la mise en production (cache, User-Agent, volume).
- Seuils LPI (5 J/kg plein score, 2 J/kg alerte) : choisis sans calibration.
- Port 8792 libre dans le catalogue du launcher.
- Limites actuelles de RainViewer, à confirmer avant la mise en production (zoom 7 annoncé, mais une tuile z8 a répondu 200 ; 100 requêtes/min non confirmé).
- Licence et format exacts de l'API Paquet Radar de Météo-France (non testée).
- Conditions d'usage actuelles de Blitzortung (forums anciens et contradictoires).
- Couverture France des impacts Blitzortung (test fait sans orage en France).
- Stabilité du flux Blitzortung (protocole non documenté).
- EUMETSAT MTG Lightning Imager : gratuité, inscription, licence, format.
- Offres commerciales d'impacts de foudre (Météorage, Vaisala, etc.) : non recherchées.
- `lightning_strike_density` (modèle RRFS, États-Unis) : non testé.
- Frontière exacte du domaine ICON-D2 : seulement 12 villes testées.
- Comptage exact des quotas Open-Meteo pour les requêtes multi-points (déduit d'un 429, non documenté) ; 600 et 700 points non testés.
- Modèles de l'Ensemble : seul `icon_seamless` testé.

## 8 bis. Version 2 (décisions du 2026-10-28)

- Thème toujours clair, carte claire (OSM sans filtre). Menu : Accueil, Chasse orage, Station, Vigilance, Autre ; sous-pages Graphiques, Analyse orage pro, Convection HD, Modèles, Fiabilité, Brief météo ; cloche et recherche.
- Vigilance officielle Météo-France (API DPVigilance, en-tête `apikey`, clé dans `~/.web_tools/meteofrance-cle.txt`). Structure lue : `product.periods[].timelaps.domain_ids[].phenomenon_items[].timelaps_items[]` (tirée d'un client open source, à confirmer avec une vraie clé). Sans clé : vigilance indicative.
- Commune et département par l'API Adresse (reverse), position arrondie à 0,01°.
- Indices d'orage depuis les niveaux de pression Open-Meteo : K, TT, LCL (125 × (T − Td)), cisaillements 0-1/0-3/0-6 km (10 m vers 925/700/500 hPa). SRH approchée (vents 10 m/925/850/700 hPa, mouvement de Bunkers) : SCP, STP, EHI marqués « approchés ». Risques grêle/vent/tornade/foudre et type d'orage : heuristiques.
- Convection HD : AROME-HD `minutely_15` sur 12 h + LPI ICON-D2 15 min.
- Grille : vent et rafales ajoutés au même appel que la CAPE (couche vent).
- Suivi automatique de la position (HTTPS requis) ; un choix manuel de ville l'arrête.
- Notifications : cloche dans la page + notification du navigateur (service worker minimal `sw.js`, aucun cache hors ligne). Pas de Web Push appli fermée (demanderait une dépendance de chiffrement).
- Nouvelle alerte « Pluies fortes » (≥ 10 mm/h) ; rayon « orage actif proche » 30 km par défaut (10/30/50/100).

## 9. Questions ouvertes

Toutes les questions de la v0.1 sont tranchées (section 7). Restent les points non vérifiés de la section 8.
