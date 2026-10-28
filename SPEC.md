# web_weather : spécification (brouillon v0.1)

Statut : débat. Aucun code. Cette spec sera complétée par le document serveur fourni plus tard.

## 1. Objectif

Application météo orientée orage, proche des captures de référence (accueil, Chasse orage, Station, Vigilance, Autre).
Serveur Python + front HTML/CSS/JS, sans framework JS.

## 2. Contrainte de sources

**Open-Meteo est la seule source de données météo** (https://github.com/open-meteo/open-meteo).
Conséquence : pas de radar, pas de Vigilance officielle, pas de capteurs de station, et pas d'impacts de foudre en direct dans Open-Meteo.
Chaque écran de la capture est donc remplacé par un équivalent calculé à partir d'Open-Meteo (section 4).
Exceptions : un fond de carte (tuiles) pour l'écran carte, à valider (voir questions ouvertes), la foudre en temps réel (section 2 bis, Blitzortung, en test) et le radar de pluie (section 2 ter, RainViewer, retenu).

### 2 bis. Foudre en temps réel : source externe (Blitzortung, à confirmer)

Open-Meteo n'a pas d'impacts réels (section 3). Source candidate pour la carte, le compteur et l'alerte d'approche : le flux websocket public de Blitzortung.org.
- Protocole : se connecter à `wss://ws1.blitzortung.org/` (secours : ws7, ws8), envoyer `{"a":111}`, recevoir des trames JSON compressées en LZW. Non documenté officiellement ; décodage tiré de clients open source (par exemple simonsorcerer23/ft8-raspi).
- Test du 2026-10-28 (25 s, une connexion) : 87 éclairs reçus (environ 204/min), 0 trame illisible, retard médian 5 s (1,6 à 22,7 s). Champs : `time` (ns), `lat`, `lon`, `alt`, `pol`, `mds`, `mcg`, `sig`, `region`, `status`, `delay`.
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

## 5. Serveur Python (à compléter)

Rôle proposé : proxy et cache vers Open-Meteo, calcul du score et des alertes, service des fichiers statiques.
Choix du framework, lancement et hébergement : **en attente du document de spec fourni par l'utilisateur**.

## 6. Contraintes

- Licence des données CC BY 4.0 : afficher « Weather data by Open-Meteo.com » avec lien.
- Usage non commercial gratuit, sans clé. Fair use : un cache serveur est obligatoire pour la grille de la carte.
- Au-delà de 10 000 requêtes/jour il faut contacter Open-Meteo.
- Les seuils d'alerte et le score de risque sont des heuristiques, à afficher comme tels.

## 7. Décisions prises

- Périmètre : tous les écrans de la capture (accueil et alertes, Chasse orage, Station, Vigilance, Autre), avec Open-Meteo comme source météo.
- Foudre : l'utilisateur veut les impacts réels en temps réel. Il veut les trois usages : points sur la carte, compteur et distance, alerte d'approche. Source retenue pour test : Blitzortung (section 2 bis).
- Radar : RainViewer retenu (section 2 ter). Vigilance officielle : pas de source ajoutée.
- Serveur Python : le document de spec arrive plus tard.
- Débat et spec d'abord. Une maquette jetable existe dans `maquette/` (lieu : Pessac 33, HTML/CSS/JS, Leaflet) : météo Open-Meteo et radar RainViewer réels, impacts de foudre **simulés**, fond de carte Esri « Dark Gray » (CARTO sombre testé puis écarté : filigrane « API key required », il exige maintenant une clé). Elle appelle les API directement depuis le navigateur ; le vrai produit passera par le serveur Python.

## 8. Non vérifié

- Conditions d'usage du service de tuiles Esri « Dark Gray » (recherche non concluante) ; état « legacy » du service.
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

## 9. Questions ouvertes

1. Fond de carte : la maquette utilise Esri « Dark Gray » (testé le 2026-10-28 : fonctionne sans clé, CORS ouvert). Mais la doc Esri le classe comme service historique (legacy), la version actuelle passe par une API avec clé, et je n'ai pas trouvé les conditions d'usage de ce point d'accès. À trancher : le garder après vérification des conditions Esri, OpenStreetMap (sa politique d'usage des tuiles est à lire, pas de thème sombre natif), ou un fournisseur avec clé gratuite. CARTO sombre est écarté (filigrane « API key required »).
2. Taille de la grille de la carte (zone, nombre de points) selon le budget de requêtes.
3. Formule exacte du score de risque et des seuils « Surveillance ».
4. Langue : français uniquement ? Unités par défaut (km/h, °C, mm).
5. Mobile d'abord (comme les captures) ou aussi bureau ?
6. Framework serveur et hébergement (document à venir).
