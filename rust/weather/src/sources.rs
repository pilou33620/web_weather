//! Ce que sert l'API : les sources externes relayées et gardées en cache.
//!   - Open-Meteo (prévisions, LPI ICON-D2, modèles, Ensemble, grille CAPE, lieux) ;
//!   - RainViewer (images radar de pluie) ;
//!   - les tuiles OpenStreetMap (fond de carte, cache disque) ;
//!   - Météo-France (vigilance officielle, clé hors git) et l'API Adresse (commune) ;
//!   - Blitzortung (impacts de foudre en temps réel, foudre.rs).
//! Le score de risque et les alertes se calculent dans la page (js/calc.js).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Map, Value};
use web_tools_commun::appairage;
use web_tools_commun::serveur::{encoder_url, params};

use crate::foudre::{self, Foudre};

pub const AGENT: &str = "web_weather/1.0 (+https://github.com/pilou33620/web_weather)";

pub const OM: &str = "https://api.open-meteo.com/v1/forecast";
pub const OM_ENSEMBLE: &str = "https://ensemble-api.open-meteo.com/v1/ensemble";
pub const OM_LIEUX: &str = "https://geocoding-api.open-meteo.com/v1/search";
pub const RAINVIEWER: &str = "https://api.rainviewer.com/public/weather-maps.json";
pub const OSM: &str = "https://tile.openstreetmap.org";
pub const BAN: &str = "https://api-adresse.data.gouv.fr/reverse/";
pub const MF_VIGILANCE: &str = "https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours";

const ACTUEL: &str = "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,\
wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,precipitation";
const HORAIRE: &str = "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,\
precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,\
pressure_msl,cloud_cover,cape,lifted_index,convective_inhibition,freezing_level_height,\
uv_index,visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,\
temperature_850hPa,temperature_700hPa,temperature_500hPa,dew_point_850hPa,dew_point_700hPa,\
wind_speed_925hPa,wind_direction_925hPa,wind_speed_850hPa,wind_direction_850hPa,\
wind_speed_700hPa,wind_direction_700hPa,wind_speed_500hPa,wind_direction_500hPa";
// (niveaux de pression : indices d'orage K, TT, cisaillements, hélicité approchée)
const QUOTIDIEN: &str = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,\
precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max";
const MODELES: &str = "ecmwf_ifs025,gfs_seamless,icon_seamless,meteofrance_arome_france,\
meteofrance_arome_france_hd,meteofrance_arpege_europe";
const MODELES_HORAIRE: &str = "temperature_2m,apparent_temperature,weather_code,precipitation,precipitation_probability,\
wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,relative_humidity_2m,pressure_msl,\
cape,lifted_index";
const MODELES_QUOTIDIEN: &str = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,\
precipitation_probability_max,wind_gusts_10m_max";

pub const GRILLE_N: usize = 15; // 15×15 points…
const GRILLE_KM: f64 = 150.0; // …sur environ 150 km : 225 appels par heure et par lieu
const RAYON_FOUDRE_KM: f64 = 300.0;
pub const RADAR_ZOOM_MAX: u32 = 7; // conditions RainViewer
pub const OSM_ZOOM_MAX: u32 = 13;
const OSM_DUREE: u64 = 7 * 86400; // une tuile OSM gardée 7 jours

pub static FOUDRE: Foudre = Foudre::new(); // démarré dans main() ; vide dans les essais

#[derive(Debug, PartialEq)]
pub enum Erreur {
    /// Paramètre de la page refusé (400).
    Parametre,
    /// Une source externe n'a pas répondu : message court, sans chemin disque (502).
    Source(String),
    /// Une source a changé de format : le dire, plutôt qu'accuser la page (502).
    Format,
}

type Res<T> = Result<T, Erreur>;

/// La racine de l'outil (index.html, cache/) : le dossier courant s'il contient index.html, sinon
/// le premier dossier au-dessus de l'exécutable qui le contient.
pub fn racine() -> &'static Path {
    static R: OnceLock<PathBuf> = OnceLock::new();
    R.get_or_init(|| {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let outil = |d: &Path| d.join("index.html").is_file() && d.join("js").join("app.js").is_file();
        if outil(&cwd) {
            return cwd;
        }
        let exe = std::env::current_exe().ok().and_then(|e| std::fs::canonicalize(e).ok());
        exe.and_then(|e| e.ancestors().find(|d| outil(d)).map(Path::to_path_buf)).unwrap_or(cwd)
    })
}

/// (cache disque des tuiles OSM, ignoré par git ; clé Météo-France, hors git, relue à chaque appel).
pub static CHEMINS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();

fn chemins() -> &'static (PathBuf, PathBuf) {
    CHEMINS.get_or_init(|| {
        let cle = appairage::dossier_personnel().join(".web_tools").join("meteofrance-cle.txt");
        (racine().join("cache"), cle)
    })
}

// --- Appels sortants et cache mémoire ------------------------------------------

/// Remplace les sources dans les essais (aucun réseau).
#[cfg(test)]
pub static FAUX: Mutex<Option<fn(&str, &[(&str, &str)]) -> Res<Vec<u8>>>> = Mutex::new(None);

fn hote_de(url: &str) -> &str {
    let reste = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    reste.split(['/', '?', ':']).next().unwrap_or("")
}

pub fn telecharger(url: &str, max_octets: u64, entetes: &[(&str, &str)]) -> Res<Vec<u8>> {
    #[cfg(test)]
    {
        let faux = *FAUX.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = faux {
            return f(url, entetes);
        }
    }
    static CLIENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
        let d = Duration::from_secs(20);
        ureq::AgentBuilder::new().timeout_connect(d).timeout_read(d).timeout_write(d).user_agent(AGENT).build()
    });
    let hote = hote_de(url);
    let mut req = CLIENT.get(url);
    for (k, v) in entetes {
        req = req.set(k, v);
    }
    let rep = match req.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(code, _)) => return Err(Erreur::Source(format!("{hote} : HTTP {code}"))),
        Err(_) => return Err(Erreur::Source(format!("{hote} injoignable"))),
    };
    let mut corps = Vec::new();
    rep.into_reader()
        .take(max_octets + 1)
        .read_to_end(&mut corps)
        .map_err(|_| Erreur::Source(format!("{hote} injoignable")))?;
    if corps.len() as u64 > max_octets {
        return Err(Erreur::Source(format!("{hote} : réponse trop grande")));
    }
    Ok(corps)
}

fn lire_json(corps: &[u8], hote: &str) -> Res<Value> {
    serde_json::from_slice(corps).map_err(|_| Erreur::Source(format!("{hote} : réponse illisible")))
}

fn json_de(url: &str, p: &[(&str, &str)]) -> Res<Value> {
    let q: Vec<String> = p.iter().map(|(k, v)| format!("{}={}", encoder_url(k), encoder_url(v))).collect();
    lire_json(&telecharger(&format!("{url}?{}", q.join("&")), 8 << 20, &[])?, hote_de(url))
}

#[derive(Clone)]
pub enum Valeur {
    Json(Arc<Value>),
    Octets(Arc<Vec<u8>>),
}

pub const CACHE_MAX: usize = 1500; // shortcut: borne en nombre d'entrées, pas en octets ; à revoir si la mémoire du Pi souffre

type Table = (HashMap<String, (Instant, u64, Valeur)>, u64); // (fin, rang d'insertion, valeur), compteur
static CACHE: LazyLock<Mutex<Table>> = LazyLock::new(|| Mutex::new((HashMap::new(), 0)));
static EN_COURS: LazyLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// La valeur gardée si elle a moins de `duree` secondes, sinon calcul() (les erreurs ne se gardent pas).
/// Un seul calcul à la fois par clé : deux appareils qui demandent la grille ensemble ne coûtent qu'un appel.
pub fn en_cache(cle: &str, duree: u64, calcul: impl FnOnce() -> Res<Valeur>) -> Res<Valeur> {
    let verrou = EN_COURS.lock().unwrap_or_else(|e| e.into_inner()).entry(cle.to_string()).or_default().clone();
    let _g = verrou.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((fin, _, v)) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).0.get(cle) {
        if *fin > Instant::now() {
            return Ok(v.clone());
        }
    }
    let valeur = calcul()?;
    let mut t = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let (table, compteur) = &mut *t;
    if table.len() >= CACHE_MAX {
        // les plus anciennes entrées d'abord
        let mut rangs: Vec<(u64, String)> = table.iter().map(|(k, (_, n, _))| (*n, k.clone())).collect();
        rangs.sort();
        let mut en_cours = EN_COURS.lock().unwrap_or_else(|e| e.into_inner());
        for (_, k) in rangs.into_iter().take(CACHE_MAX / 2) {
            table.remove(&k);
            en_cours.remove(&k);
        }
    }
    *compteur += 1; // réinsérée avec un rang neuf : l'ordre suit la fraîcheur
    table.insert(cle.to_string(), (Instant::now() + Duration::from_secs(duree), *compteur, valeur.clone()));
    Ok(valeur)
}

fn json_en_cache(cle: &str, duree: u64, calcul: impl FnOnce() -> Res<Value>) -> Res<Arc<Value>> {
    match en_cache(cle, duree, || calcul().map(|v| Valeur::Json(Arc::new(v))))? {
        Valeur::Json(v) => Ok(v),
        Valeur::Octets(_) => Err(Erreur::Format),
    }
}

/// Oublie une entrée (essais).
pub fn oublier(cle: &str) {
    CACHE.lock().unwrap_or_else(|e| e.into_inner()).0.remove(cle);
}

// --- Petites aides de lecture -----------------------------------------------------

/// Première valeur non vide du paramètre (parse_qs de Python).
pub fn param(q: &str, nom: &str) -> Option<String> {
    params(q).into_iter().find(|(k, v)| k == nom && !v.is_empty()).map(|(_, v)| v)
}

fn arrondi(x: f64, n: i32) -> f64 {
    let f = 10f64.powi(n);
    (x * f).round_ties_even() / f
}

/// str() de Python pour une valeur JSON : un texte tel quel, le reste en JSON.
fn texte(v: Option<&Value>) -> String {
    match v {
        None => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(x) => x.to_string(),
    }
}

/// Une valeur « fausse » pour Python (None, 0, "", [], {}).
fn faux(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::Bool(b) => !b,
        Value::Number(n) => n.as_f64() == Some(0.0),
        Value::String(s) => s.is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
    }
}

/// `x or []` puis une boucle : une liste, rien si absent, Format si autre chose.
fn liste(v: Option<&Value>) -> Res<&[Value]> {
    match v {
        Some(Value::Array(a)) => Ok(a),
        Some(x) if !faux(x) => Err(Erreur::Format),
        _ => Ok(&[]),
    }
}

/// int() de Python.
fn entier(v: &Value) -> Res<i64> {
    match v {
        Value::Bool(b) => Ok(*b as i64),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f as i64)).ok_or(Erreur::Format),
        Value::String(s) => s.trim().parse().map_err(|_| Erreur::Format),
        _ => Err(Erreur::Format),
    }
}

/// int(x or 1)
fn entier_ou_1(v: Option<&Value>) -> Res<i64> {
    match v {
        Some(x) if !faux(x) => entier(x),
        _ => Ok(1),
    }
}

fn champ<'a>(v: &'a Value, cle: &str) -> Res<&'a Value> {
    v.get(cle).ok_or(Erreur::Format)
}

// --- Ce que sert l'API ----------------------------------------------------------

/// (lat, lon) arrondis à `pas`, ou Parametre. Un lieu arrondi partage son cache.
pub fn coordonnees(q: &str, pas: f64) -> Res<(f64, f64)> {
    let lire = |n: &str| param(q, n).and_then(|v| v.trim().parse::<f64>().ok()).ok_or(Erreur::Parametre);
    let (lat, lon) = (lire("lat")?, lire("lon")?);
    if !(lat.is_finite() && lon.is_finite() && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)) {
        return Err(Erreur::Parametre);
    }
    let a = |x: f64| arrondi((x / pas).round_ties_even() * pas, 4);
    Ok((a(lat), a(lon)))
}

/// Le LPI (potentiel de foudre) d'une réponse ICON-D2, sous `bloc` (hourly ou minutely_15).
fn lpi_de(r: Res<Value>, bloc: &str) -> Option<Value> {
    let r = r.ok()?;
    let l = r.get(bloc)?;
    Some(json!({"time": l.get("time")?.clone(), "valeurs": l.get("lightning_potential")?.clone()}))
}

pub fn meteo(lat: f64, lon: f64) -> Res<Arc<Value>> {
    let (la, lo) = (lat.to_string(), lon.to_string());
    let (la, lo) = (la.as_str(), lo.as_str());
    json_en_cache(&format!("meteo|{la}|{lo}"), 600, || {
        let prevision = json_de(OM, &[("latitude", la), ("longitude", lo), ("timezone", "auto"), ("forecast_days", "10"),
            ("wind_speed_unit", "kmh"), ("current", ACTUEL), ("hourly", HORAIRE), ("daily", QUOTIDIEN)])?;
        // Le LPI n'existe qu'avec ICON-D2 (Europe centrale) : appel séparé, absent ailleurs
        let lpi = lpi_de(json_de(OM, &[("latitude", la), ("longitude", lo), ("timezone", "auto"), ("forecast_days", "2"),
            ("models", "icon_d2"), ("hourly", "lightning_potential")]), "hourly")
        .filter(|l| !l["valeurs"].as_array().is_some_and(|a| a.iter().all(Value::is_null)));
        Ok(json!({"prevision": prevision, "lpi": lpi}))
    })
}

pub fn modeles(lat: f64, lon: f64) -> Res<Arc<Value>> {
    let (la, lo) = (lat.to_string(), lon.to_string());
    let (la, lo) = (la.as_str(), lo.as_str());
    json_en_cache(&format!("modeles|{la}|{lo}"), 1800, || {
        json_de(OM, &[("latitude", la), ("longitude", lo), ("timezone", "auto"), ("forecast_days", "7"),
            ("wind_speed_unit", "kmh"), ("models", MODELES), ("hourly", MODELES_HORAIRE), ("daily", MODELES_QUOTIDIEN)])
    })
}

/// AROME-HD (1,5 km) par quart d'heure sur 12 h, et le LPI ICON-D2 au même pas s'il existe.
pub fn convection(lat: f64, lon: f64) -> Res<Arc<Value>> {
    let (la, lo) = (lat.to_string(), lon.to_string());
    let (la, lo) = (la.as_str(), lo.as_str());
    json_en_cache(&format!("convection|{la}|{lo}"), 900, || {
        let arome = json_de(OM, &[("latitude", la), ("longitude", lo), ("timezone", "auto"), ("wind_speed_unit", "kmh"),
            ("models", "meteofrance_arome_france_hd"), ("forecast_minutely_15", "48"),
            ("minutely_15", "precipitation,cape,wind_gusts_10m")])?;
        let lpi = lpi_de(json_de(OM, &[("latitude", la), ("longitude", lo), ("timezone", "auto"), ("models", "icon_d2"),
            ("forecast_minutely_15", "48"), ("minutely_15", "lightning_potential")]), "minutely_15");
        Ok(json!({"arome": arome.get("minutely_15"), "lpi": lpi}))
    })
}

pub fn ensemble(lat: f64, lon: f64) -> Res<Arc<Value>> {
    let (la, lo) = (lat.to_string(), lon.to_string());
    let (la, lo) = (la.as_str(), lo.as_str());
    json_en_cache(&format!("ensemble|{la}|{lo}"), 3600, || {
        json_de(OM_ENSEMBLE, &[("latitude", la), ("longitude", lo), ("timezone", "auto"), ("forecast_days", "3"),
            ("models", "icon_seamless"), ("hourly", "temperature_2m,precipitation")])
    })
}

pub fn points_grille(lat: f64, lon: f64) -> (Vec<f64>, Vec<f64>) {
    let dlat = GRILLE_KM / (GRILLE_N - 1) as f64 / 111.32;
    let dlon = dlat / lat.to_radians().cos().max(0.1);
    let m = (GRILLE_N / 2) as f64;
    let lats = (0..GRILLE_N).map(|i| arrondi(lat + (i as f64 - m) * dlat, 3)).collect();
    let lons = (0..GRILLE_N).map(|j| arrondi(lon + (j as f64 - m) * dlon, 3)).collect();
    (lats, lons)
}

/// Champs des 24 prochaines heures sur la grille : cape[h][i * N + j] (i : latitude, j : longitude).
pub fn grille(lat: f64, lon: f64) -> Res<Arc<Value>> {
    json_en_cache(&format!("grille|{lat}|{lon}"), 3600, || {
        let (lats, lons) = points_grille(lat, lon);
        let (mut la, mut lo) = (Vec::new(), Vec::new());
        for a in &lats {
            for b in &lons {
                la.push(a.to_string());
                lo.push(b.to_string());
            }
        }
        let (la, lo) = (la.join(","), lo.join(","));
        let rep = json_de(OM, &[("latitude", la.as_str()), ("longitude", lo.as_str()),
            ("hourly", "cape,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,cloud_cover,pressure_msl"),
            ("forecast_days", "2"), ("wind_speed_unit", "kmh"), ("timezone", "auto")])?;
        let points = rep.as_array().ok_or(Erreur::Format)?;
        let premier = points.first().ok_or(Erreur::Format)?;
        let decalage = champ(premier, "utc_offset_seconds")?.as_f64().ok_or(Erreur::Format)?;
        let decalage = chrono::TimeDelta::try_seconds(decalage as i64).ok_or(Erreur::Format)?;
        let maintenant = (chrono::Utc::now() + decalage).format("%Y-%m-%dT%H:00").to_string();
        let heures = champ(champ(premier, "hourly")?, "time")?.as_array().ok_or(Erreur::Format)?;
        let mut debut = 0;
        for (k, t) in heures.iter().enumerate() {
            if t.as_str().ok_or(Erreur::Format)? >= maintenant.as_str() {
                debut = k;
                break;
            }
        }
        let fin = (debut + 24).min(heures.len());
        let champ_grille = |nom: &str| -> Res<Value> {
            let mut h = Vec::new();
            for k in debut..fin {
                let mut ligne = Vec::with_capacity(points.len());
                for p in points {
                    ligne.push(p.get("hourly").and_then(|x| x.get(nom)).and_then(|x| x.get(k)).cloned().ok_or(Erreur::Format)?);
                }
                h.push(Value::Array(ligne));
            }
            Ok(Value::Array(h))
        };
        Ok(json!({"lats": lats, "lons": lons, "time": heures[debut..fin], "cape": champ_grille("cape")?,
            "vent": champ_grille("wind_speed_10m")?, "direction": champ_grille("wind_direction_10m")?,
            "rafales": champ_grille("wind_gusts_10m")?, "temperature": champ_grille("temperature_2m")?,
            "nuages": champ_grille("cloud_cover")?, "pression": champ_grille("pressure_msl")?}))
    })
}

/// {"host": …, "images": {heure: chemin}} de RainViewer, gardé 2 min.
fn radar_brut() -> Res<Arc<Value>> {
    json_en_cache("radar", 120, || {
        let r = lire_json(&telecharger(RAINVIEWER, 8 << 20, &[])?, "api.rainviewer.com")?;
        let mut images = Map::new();
        for f in liste(Some(champ(champ(&r, "radar")?, "past")?))? {
            let t = entier(champ(f, "time")?)?;
            images.insert(t.to_string(), champ(f, "path")?.clone());
        }
        Ok(json!({"host": texte(Some(champ(&r, "host")?)), "images": images}))
    })
}

pub fn radar() -> Res<Arc<Value>> {
    let r = radar_brut()?;
    let images: Vec<i64> = r["images"].as_object().map(|m| m.keys().filter_map(|k| k.parse().ok()).collect()).unwrap_or_default();
    Ok(Arc::new(json!({"images": images, "zoom_max": RADAR_ZOOM_MAX})))
}

fn dans_la_carte(z: u32, x: u64, y: u64) -> bool {
    x < 1 << z && y < 1 << z
}

fn octets_en_cache(cle: &str, duree: u64, calcul: impl FnOnce() -> Res<Vec<u8>>) -> Res<Arc<Vec<u8>>> {
    match en_cache(cle, duree, || calcul().map(|o| Valeur::Octets(Arc::new(o))))? {
        Valeur::Octets(o) => Ok(o),
        Valeur::Json(_) => Err(Erreur::Format),
    }
}

pub fn tuile_radar(t: i64, z: u32, x: u64, y: u64) -> Res<Option<Arc<Vec<u8>>>> {
    if z > RADAR_ZOOM_MAX || !dans_la_carte(z, x, y) {
        return Ok(None);
    }
    let r = radar_brut()?;
    // Le chemin vient de la liste de RainViewer : la page ne choisit qu'une heure de cette liste
    let chemin = match r["images"].get(t.to_string()) {
        Some(c) if !faux(c) => texte(Some(c)),
        _ => return Ok(None),
    };
    let url = format!("{}{}/256/{z}/{x}/{y}/2/1_1.png", texte(r.get("host")), chemin);
    octets_en_cache(&url, 7200, || telecharger(&url, 1 << 20, &[])).map(Some)
}

/// Tuile OSM depuis le cache disque (7 jours), sinon téléchargée puis rangée.
/// Si OSM ne répond pas, une tuile périmée vaut mieux que rien.
pub fn tuile_osm(z: u32, x: u64, y: u64) -> Res<Option<Arc<Vec<u8>>>> {
    if z > OSM_ZOOM_MAX || !dans_la_carte(z, x, y) {
        return Ok(None);
    }
    let fichier = chemins().0.join("osm").join(z.to_string()).join(x.to_string()).join(format!("{y}.png"));
    let age = std::fs::metadata(&fichier).and_then(|m| m.modified()).ok().and_then(|m| SystemTime::now().duration_since(m).ok());
    if age.is_some_and(|a| a.as_secs() < OSM_DUREE) {
        if let Ok(o) = std::fs::read(&fichier) {
            return Ok(Some(Arc::new(o)));
        }
    }
    let corps = match telecharger(&format!("{OSM}/{z}/{x}/{y}.png"), 1 << 20, &[]) {
        Ok(c) => c,
        Err(e) => {
            if fichier.is_file() {
                if let Ok(o) = std::fs::read(&fichier) {
                    return Ok(Some(Arc::new(o)));
                }
            }
            return Err(e);
        }
    };
    // shortcut: le cache disque n'est jamais purgé ; quelques dizaines de Mo autour d'un lieu, à purger si on voyage beaucoup
    static NUMERO: AtomicU64 = AtomicU64::new(0);
    let tmp = fichier.with_extension(format!("png.{}.{}.tmp", std::process::id(), NUMERO.fetch_add(1, Ordering::SeqCst)));
    let ecrit = fichier
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| std::fs::write(&tmp, &corps))
        .and_then(|_| std::fs::rename(&tmp, &fichier));
    if ecrit.is_err() {
        let _ = std::fs::remove_file(&tmp); // disque plein : la tuile sert quand même, sans rester tronquée
    }
    Ok(Some(Arc::new(corps)))
}

pub fn lieux(saisi: &str) -> Res<Arc<Value>> {
    let saisi = saisi.trim();
    if !(2..=60).contains(&saisi.chars().count()) {
        return Err(Erreur::Parametre);
    }
    json_en_cache(&format!("lieux|{}", saisi.to_lowercase()), 86400, || {
        let rep = json_de(OM_LIEUX, &[("name", saisi), ("count", "8"), ("language", "fr"), ("format", "json")])?;
        let mut sortie = Vec::new();
        for r in liste(rep.get("results"))? {
            let ou_vide = |k: &str| r.get(k).cloned().unwrap_or_else(|| json!(""));
            sortie.push(json!({"nom": ou_vide("name"), "region": ou_vide("admin1"), "pays": ou_vide("country"),
                "lat": champ(r, "latitude")?, "lon": champ(r, "longitude")?}));
        }
        Ok(Value::Array(sortie))
    })
}

pub fn departement(d: &str) -> bool {
    let b = d.as_bytes();
    match b.len() {
        2 => b.iter().all(u8::is_ascii_digit) || (b[0] == b'2' && (b[1] == b'A' || b[1] == b'B')),
        3 => b[0] == b'9' && b[1] == b'7' && b[2].is_ascii_digit(),
        _ => false,
    }
}

/// Commune et département d'une position (API Adresse, France seulement), ou null ailleurs.
/// La position est déjà arrondie à 0,01° (environ 1 km) : l'adresse exacte ne part pas.
pub fn commune(lat: f64, lon: f64) -> Res<Arc<Value>> {
    let (la, lo) = (lat.to_string(), lon.to_string());
    let (la, lo) = (la.as_str(), lo.as_str());
    json_en_cache(&format!("commune|{la}|{lo}"), 30 * 86400, || {
        let rep = json_de(BAN, &[("lat", la), ("lon", lo), ("limit", "1")])?;
        let Some(premier) = rep.get("features").filter(|f| !faux(f)) else { return Ok(Value::Null) };
        let p = champ(premier.get(0).ok_or(Erreur::Format)?, "properties")?;
        let contexte = texte(p.get("context"));
        let dep = contexte.split(',').next().unwrap_or("").trim();
        Ok(json!({"nom": texte(p.get("city")), "departement": departement(dep).then_some(dep)}))
    })
}

/// Carte de vigilance Météo-France en cours, réduite à l'utile, par département.
fn carte_vigilance() -> Res<Arc<Value>> {
    let cle = std::fs::read_to_string(&chemins().1).map(|c| c.trim().to_string()).unwrap_or_default();
    if cle.is_empty() {
        return Err(Erreur::Source("clé Météo-France absente (~/.web_tools/meteofrance-cle.txt)".into()));
    }
    json_en_cache("vigilance-mf", 600, || {
        let brut = lire_json(&telecharger(MF_VIGILANCE, 8 << 20, &[("apikey", cle.as_str())])?, "public-api.meteofrance.fr")?;
        let mut periodes = Vec::new();
        for per in champ(champ(&brut, "product")?, "periods")?.as_array().ok_or(Erreur::Format)? {
            let items = per.get("text_items").filter(|t| !faux(t));
            if items.is_some_and(|t| !t.is_object()) {
                return Err(Erreur::Format);
            }
            let textes = items.and_then(|t| t.get("text")).filter(|t| !faux(t));
            let texte_per = match textes {
                Some(Value::Array(l)) => l.iter().map(|t| texte(Some(t))).collect::<Vec<_>>().join(" "),
                Some(t) => texte(Some(t)),
                None => String::new(),
            };
            let mut deps = Map::new();
            for d in champ(champ(per, "timelaps")?, "domain_ids")?.as_array().ok_or(Erreur::Format)? {
                let mut phenomenes = Vec::new();
                for ph in liste(d.get("phenomenon_items"))? {
                    let mut tranches = Vec::new();
                    for t in liste(ph.get("timelaps_items"))? {
                        tranches.push(json!({"debut": t.get("begin_time"), "fin": t.get("end_time"),
                            "couleur": entier_ou_1(t.get("color_id"))?}));
                    }
                    phenomenes.push(json!({"id": entier(champ(ph, "phenomenon_id")?)?,
                        "couleur": entier_ou_1(ph.get("phenomenon_max_color_id"))?, "tranches": tranches}));
                }
                deps.insert(texte(Some(champ(d, "domain_id")?)),
                    json!({"couleur": entier_ou_1(d.get("max_color_id"))?, "phenomenes": phenomenes}));
            }
            periodes.push(json!({"echeance": per.get("echeance"), "debut": per.get("begin_validity_time"),
                "fin": per.get("end_validity_time"), "texte": texte_per, "departements": deps}));
        }
        Ok(Value::Array(periodes))
    })
}

pub fn vigilance(q: &str) -> Res<Arc<Value>> {
    let dep = param(q, "dep").unwrap_or_default().to_uppercase();
    if !departement(&dep) {
        return Err(Erreur::Parametre);
    }
    let periodes = match carte_vigilance() {
        Ok(p) => p,
        // la page affiche alors la vigilance indicative
        Err(Erreur::Source(raison)) => return Ok(Arc::new(json!({"officielle": false, "raison": raison}))),
        Err(_) => return Ok(Arc::new(json!({"officielle": false, "raison": "Météo-France : format de réponse inattendu"}))),
    };
    let defaut = json!({"couleur": 1, "phenomenes": []});
    let mut liste_dep = Vec::new();
    for p in periodes.as_array().into_iter().flatten() {
        let mut m = Map::new();
        for k in ["echeance", "debut", "fin", "texte"] {
            m.insert(k.into(), p[k].clone());
        }
        if let Some(o) = p["departements"].get(&dep).unwrap_or(&defaut).as_object() {
            m.extend(o.clone());
        }
        liste_dep.push(Value::Object(m));
    }
    Ok(Arc::new(json!({"officielle": true, "departement": dep, "periodes": liste_dep})))
}

pub fn impacts(lat: f64, lon: f64) -> Arc<Value> {
    let maintenant = foudre::maintenant_ms();
    Arc::new(json!({"maintenant": maintenant, "etat": FOUDRE.etat(),
        "impacts": FOUDRE.autour(lat, lon, RAYON_FOUDRE_KM, maintenant)}))
}

/// Les routes de l'API (GET) : None si le chemin n'en est pas une.
pub fn api(chemin: &str, q: &str) -> Option<Res<Arc<Value>>> {
    let c = || coordonnees(q, 0.01);
    Some(match chemin {
        "/api/meteo" => c().and_then(|(a, b)| meteo(a, b)),
        "/api/modeles" => c().and_then(|(a, b)| modeles(a, b)),
        "/api/ensemble" => c().and_then(|(a, b)| ensemble(a, b)),
        "/api/convection" => c().and_then(|(a, b)| convection(a, b)),
        "/api/commune" => c().and_then(|(a, b)| commune(a, b)),
        "/api/vigilance" => vigilance(q),
        "/api/grille" => coordonnees(q, 0.1).and_then(|(a, b)| grille(a, b)),
        "/api/foudre" => c().map(|(a, b)| impacts(a, b)),
        "/api/radar" => radar(),
        "/api/lieux" => lieux(&param(q, "q").unwrap_or_default()),
        _ => return None,
    })
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn coordonnees_arrondies() {
        assert_eq!(coordonnees("lat=44.80565&lon=-0.6324", 0.01), Ok((44.81, -0.63)));
        assert_eq!(coordonnees("lat=44.8061&lon=-0.6319", 0.01), Ok((44.81, -0.63)));
        assert_eq!(coordonnees("lat=44.84&lon=-0.66", 0.1), Ok((44.8, -0.7)));
        for q in ["", "lat=abc&lon=1", "lat=91&lon=0", "lat=0&lon=181", "lat=nan&lon=0", "lat=inf&lon=0"] {
            assert_eq!(coordonnees(q, 0.01), Err(Erreur::Parametre), "{q}");
        }
    }

    #[test]
    fn departements() {
        for d in ["33", "2A", "2B", "974", "01"] {
            assert!(departement(d), "{d}");
        }
        for d in ["", "3", "2C", "../33", "984", "333"] {
            assert!(!departement(d), "{d}");
        }
    }

    #[test]
    fn grille_centree() {
        let (lats, lons) = points_grille(44.8, -0.6);
        assert_eq!((lats.len(), lons.len()), (GRILLE_N, GRILLE_N));
        assert_eq!((lats[7], lons[7]), (44.8, -0.6));
        assert!(lats[0] < 44.8 && lons[14] > -0.6);
    }

    #[test]
    fn hotes() {
        assert_eq!(hote_de("https://api.open-meteo.com/v1/forecast?x=1"), "api.open-meteo.com");
        assert_eq!(hote_de("https://tiles.exemple:8443/a"), "tiles.exemple");
    }
}
