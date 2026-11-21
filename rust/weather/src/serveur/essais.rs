//! Banc du serveur : ce qu'il sert, ce qu'il refuse, sans réseau.
//! Le serveur démarre sur un port libre de 127.0.0.1. Les sources externes (Open-Meteo,
//! RainViewer, OSM, Météo-France, API Adresse) sont remplacées par de fausses réponses.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{LazyLock, Mutex};

use serde_json::{json, Value};

use super::*;
use crate::sources::{BAN, CHEMINS, FAUX, MF_VIGILANCE, RAINVIEWER};

static APPELS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static PANNE: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());
static VIGI_ABIMEE: AtomicBool = AtomicBool::new(false);
static HEURES: LazyLock<Vec<String>> = LazyLock::new(|| {
    let h = chrono::Utc::now().format("%Y-%m-%dT%H:00").to_string();
    let t = chrono::NaiveDateTime::parse_from_str(&h, "%Y-%m-%dT%H:%M").unwrap();
    (-3..45).map(|k| (t + chrono::TimeDelta::hours(k)).format("%Y-%m-%dT%H:00").to_string()).collect()
});

fn appels() -> usize {
    APPELS.lock().unwrap().len()
}

fn vigi() -> Value {
    if VIGI_ABIMEE.load(Ordering::SeqCst) {
        return json!({"product": {"periods": [{"timelaps": {}}]}});
    }
    json!({"product": {"periods": [{"echeance": "J", "begin_validity_time": "2026-10-28T06:00:00+00:00",
        "end_validity_time": "2026-10-29T00:00:00+00:00", "text_items": {"text": ["Orages forts", "sur l'ouest."]},
        "timelaps": {"domain_ids": [
            {"domain_id": "33", "max_color_id": 3, "phenomenon_items": [
                {"phenomenon_id": "3", "phenomenon_max_color_id": 3,
                 "timelaps_items": [{"begin_time": "2026-10-28T16:00:00+00:00", "end_time": "2026-10-28T23:00:00+00:00", "color_id": 3}]},
                {"phenomenon_id": "1", "phenomenon_max_color_id": 2, "timelaps_items": []}]},
            {"domain_id": "75", "max_color_id": 1, "phenomenon_items": []}]}}]}})
}

fn faux(url: &str, entetes: &[(&str, &str)]) -> Result<Vec<u8>, Erreur> {
    APPELS.lock().unwrap().push(url.to_string());
    let ok = |v: Value| -> Result<Vec<u8>, Erreur> { Ok(v.to_string().into_bytes()) };
    let h = &*HEURES;
    if url.starts_with(MF_VIGILANCE) {
        if !entetes.contains(&("apikey", "bonne-cle")) {
            return Err(Erreur::Source("public-api.meteofrance.fr : HTTP 401".into()));
        }
        return ok(vigi());
    }
    if url.starts_with(BAN) {
        if url.contains("lat=40.4") {
            return ok(json!({"features": []})); // Madrid : hors de France
        }
        return ok(json!({"features": [{"properties": {"city": "Pessac", "context": "33, Gironde, Nouvelle-Aquitaine"}}]}));
    }
    if url.contains("minutely_15=") {
        if url.contains("icon_d2") {
            return Err(Erreur::Source("api.open-meteo.com : HTTP 400".into()));
        }
        return ok(json!({"minutely_15": {"time": h[..2], "precipitation": [0, 1.2]}}));
    }
    if PANNE.lock().unwrap().iter().any(|p| url.contains(p)) {
        return Err(Erreur::Source("source.exemple : HTTP 429".into()));
    }
    if url.starts_with(RAINVIEWER) {
        return ok(json!({"host": "https://tiles.exemple", "radar": {"past": [{"time": 1793209800, "path": "/v2/radar/abc"}]}}));
    }
    if url.ends_with(".png") {
        return Ok(format!("PNG:{url}").into_bytes());
    }
    if url.contains("models=icon_d2") {
        return ok(json!({"hourly": {"time": h[..3], "lightning_potential": [0, 1.5, null]}}));
    }
    if url.contains("latitude=") && url.contains("%2C") {
        // grille : une réponse par point
        let n = url.split("latitude=").nth(1).unwrap().split('&').next().unwrap().matches("%2C").count() + 1;
        let k = h.len();
        let points: Vec<Value> = (0..n)
            .map(|p| json!({"utc_offset_seconds": 0, "hourly": {"time": h, "cape": vec![p as f64; k],
                "wind_speed_10m": vec![10.0; k], "wind_direction_10m": vec![270; k], "wind_gusts_10m": vec![30.0; k],
                "temperature_2m": vec![12.5; k], "cloud_cover": vec![80; k], "pressure_msl": vec![1012.0 + p as f64 / 100.0; k]}}))
            .collect();
        return ok(Value::Array(points));
    }
    if url.contains("geocoding") {
        return ok(json!({"results": [{"name": "<b>Pessac</b>", "admin1": "Nouvelle-Aquitaine", "country": "France",
            "latitude": 44.8, "longitude": -0.63}]}));
    }
    ok(json!({"current": {"time": h[3]}, "hourly": {"time": h}}))
}

fn illisible(_: &str, _: &[(&str, &str)]) -> Result<Vec<u8>, Erreur> {
    Ok(b"<html>erreur</html>".to_vec())
}

fn liste_vide(_: &str, _: &[(&str, &str)]) -> Result<Vec<u8>, Erreur> {
    Ok(b"[]".to_vec())
}

struct Rep {
    code: u16,
    tete: String,
    corps: Vec<u8>,
}

impl Rep {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.corps).unwrap_or(Value::Null)
    }
}

fn requete(port: u16, chemin: &str, hote: Option<&str>, methode: &str) -> Rep {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let hote = hote.map(String::from).unwrap_or_else(|| format!("127.0.0.1:{port}"));
    write!(s, "{methode} {chemin} HTTP/1.0\r\nHost: {hote}\r\n\r\n").unwrap();
    let mut brut = Vec::new();
    let _ = s.read_to_end(&mut brut);
    let fin = brut.windows(4).position(|w| w == b"\r\n\r\n").expect("réponse sans en-têtes");
    let tete = String::from_utf8_lossy(&brut[..fin]).into_owned();
    let code = tete.split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    Rep { code, tete, corps: brut[fin + 4..].to_vec() }
}

#[test]
fn ligne_de_commande() {
    let a = |l: &[&str]| l.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    // la commande du catalogue web_launcher
    let x = lire_args(&a(&["--port", "8792", "--sans-navigateur", "--sans-pause", "--sans-maj"])).unwrap();
    assert_eq!((x.port, x.sans_navigateur, x.sans_pause, x.sans_maj, x.local), (8792, true, true, true, false));
    assert_eq!(lire_args(&[]).unwrap().port, PORT);
    assert!(lire_args(&a(&["--local"])).unwrap().local);
    assert_eq!(lire_args(&a(&["--port=9000"])).unwrap().port, 9000);
    assert!(lire_args(&a(&["--port"])).is_err());
    assert!(lire_args(&a(&["--port", "abc"])).is_err());
    assert!(lire_args(&a(&["--inconnu"])).is_err());
    assert!(lire_args(&a(&["--local=1"])).is_err());
}

#[test]
fn tuiles_reconnues() {
    assert_eq!(tuile("/tuiles/osm/7/63/45.png"), Some((None, 7, 63, 45)));
    assert_eq!(tuile("/tuiles/radar/1793209800/6/31/22.png"), Some((Some(1793209800), 6, 31, 22)));
    for c in ["/tuiles/osm/../../serveur.py", "/tuiles/osm/123/0/0.png", "/tuiles/radar/12/1/0/0.png", "/tuiles/osm/1/0/0.png/x"] {
        assert_eq!(tuile(c), None, "{c}");
    }
}

#[test]
fn banc_serveur() {
    let tmp: PathBuf = std::env::temp_dir().join(format!("web_weather_essai_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let cle = tmp.join("meteofrance-cle.txt");
    assert!(CHEMINS.set((tmp.join("cache"), cle.clone())).is_ok());
    *FAUX.lock().unwrap() = Some(faux);
    let _ = GARDE.set(Garde::new("WEB_WEATHER", false, None, None));
    let srv = Serveur::ouvrir(0, false, 1).unwrap();
    srv.servir_en_fond(Arc::new(repondre));
    let port = srv.port();
    let get = |c: &str| requete(port, c, None, "GET");

    // --- Fichiers servis et refusés
    for (c, attendu) in [
        ("/", 200), ("/index.html", 200), ("/sw.js", 200), ("/manifest.json", 200), ("/js/graph.js", 200),
        ("/css/style.css", 200), ("/js/app.js", 200), ("/js/calc.js", 200), ("/css/icone.svg", 200),
        ("/vendor/leaflet/leaflet.js", 200), ("/vendor/leaflet/leaflet.css", 200), ("/favicon.ico", 204),
        ("/.git/config", 404), ("/.gitignore", 404), ("/Cargo.toml", 404), ("/rust/weather/src/serveur.rs", 404),
        ("/README.md", 404), ("/SPEC.md", 404), ("/js/", 404), ("/js/../Cargo.toml", 404), ("/js/%2e%2e/Cargo.toml", 404),
        ("/js/.cache.js", 404), ("/vendor/leaflet", 404), ("/cache/osm/1/0/0.png", 404), ("/test/test_calc.js", 404),
        ("/C:%5cWindows%5cwin.ini", 404), ("/api/inconnue", 404),
    ] {
        assert_eq!(get(c).code, attendu, "GET {c}");
    }
    assert_eq!(requete(port, "/.git/config", None, "HEAD").code, 404);
    assert_eq!(requete(port, "/", Some("evil.example:8792"), "GET").code, 403, "Host étranger");
    assert_eq!(requete(port, "/api/radar", Some("evil.example:8792"), "GET").code, 403, "Host étranger sur l'API");
    assert_eq!(requete(port, "/", Some("192.168.1.20:8792"), "GET").code, 200, "Host IP locale");
    assert_eq!(requete(port, "/api/meteo", None, "POST").code, 501, "aucune route n'écrit");
    let t = get("/").tete;
    assert!(t.contains("X-Frame-Options: SAMEORIGIN") && t.contains("X-Content-Type-Options: nosniff"), "{t}");
    assert!(t.contains("frame-ancestors 'self'") && t.contains("Cache-Control: no-store, max-age=0"), "{t}");

    // --- API : paramètres
    for q in ["", "lat=abc&lon=1", "lat=91&lon=0", "lat=0&lon=181", "lat=nan&lon=0", "lat=inf&lon=0"] {
        assert_eq!(get(&format!("/api/meteo?{q}")).code, 400, "paramètres refusés : {q}");
    }
    assert_eq!(get("/api/lieux?q=a").code, 400, "lieu trop court");

    // --- API : relais et cache
    let r = get("/api/meteo?lat=44.80565&lon=-0.6324");
    assert_eq!((r.code, r.json()["lpi"]["valeurs"].clone()), (200, json!([0, 1.5, null])), "météo + LPI");
    let avant = appels();
    get("/api/meteo?lat=44.8061&lon=-0.6319"); // même lieu une fois arrondi
    assert_eq!(appels(), avant, "météo : cache par lieu arrondi");

    let r = get("/api/grille?lat=44.8&lon=-0.63");
    let g = r.json();
    assert_eq!(r.code, 200);
    assert_eq!((g["lats"].as_array().unwrap().len(), g["lons"].as_array().unwrap().len()), (15, 15));
    assert_eq!(g["cape"][0].as_array().unwrap().len(), 225, "grille 15×15");
    assert_eq!(g["time"].as_array().unwrap().len(), 24, "grille : 24 h");
    assert_eq!(g["time"][0], HEURES[3].as_str(), "grille : à partir de l'heure en cours");
    assert_eq!(APPELS.lock().unwrap().iter().filter(|u| u.contains("hourly=cape")).count(), 1, "un seul appel pour 225 points");
    assert_eq!(g["cape"][0][16], 16.0, "grille : point i, j");
    assert_eq!((g["vent"][0][0].clone(), g["direction"][0][0].clone(), g["rafales"][0][0].clone()), (json!(10.0), json!(270), json!(30.0)));
    assert_eq!((g["temperature"][0][0].clone(), g["nuages"][0][0].clone(), g["pression"][0][16].clone()), (json!(12.5), json!(80), json!(1012.16)));

    let r = get("/api/convection?lat=44.8&lon=-0.63");
    let c = r.json();
    assert_eq!((r.code, c["arome"]["precipitation"].clone(), c["lpi"].clone()), (200, json!([0, 1.2]), Value::Null), "convection");

    assert_eq!(get("/api/commune?lat=44.8056&lon=-0.6324").json(), json!({"nom": "Pessac", "departement": "33"}));
    let r = get("/api/commune?lat=40.4&lon=-3.7");
    assert_eq!((r.code, r.corps.as_slice()), (200, &b"null"[..]), "commune hors de France");
    assert!(APPELS.lock().unwrap().iter().any(|u| u.contains("lat=44.81&lon=-0.63&")), "position arrondie avant l'envoi");

    assert_eq!(get("/api/vigilance?dep=../33").code, 400, "vigilance : département refusé");
    let v = get("/api/vigilance?dep=33").json();
    assert!(v["officielle"] == false && v["raison"].as_str().unwrap().contains("clé"), "sans clé : {v}");
    std::fs::write(&cle, "mauvaise-cle\n").unwrap();
    let v = get("/api/vigilance?dep=33").json();
    assert_eq!(v, json!({"officielle": false, "raison": "public-api.meteofrance.fr : HTTP 401"}));
    std::fs::write(&cle, "bonne-cle\n").unwrap();
    let v = get("/api/vigilance?dep=33").json();
    let p0 = &v["periodes"][0];
    assert_eq!(
        (v["officielle"].clone(), p0["couleur"].clone(), p0["phenomenes"][0]["id"].clone(),
         p0["phenomenes"][0]["tranches"][0]["couleur"].clone(), p0["texte"].clone()),
        (json!(true), json!(3), json!(3), json!(3), json!("Orages forts sur l'ouest.")),
        "Gironde orange orages"
    );
    let cles: Vec<&String> = p0.as_object().unwrap().keys().collect();
    assert_eq!(cles, ["echeance", "debut", "fin", "texte", "couleur", "phenomenes"], "ordre des clés");
    assert_eq!(get("/api/vigilance?dep=2A").json()["periodes"][0]["couleur"], 1, "département sans phénomène");
    sources::oublier("vigilance-mf");
    VIGI_ABIMEE.store(true, Ordering::SeqCst);
    assert_eq!(get("/api/vigilance?dep=33").json(), json!({"officielle": false, "raison": "Météo-France : format de réponse inattendu"}));
    VIGI_ABIMEE.store(false, Ordering::SeqCst);
    assert!(!String::from_utf8_lossy(&get("/api/vigilance?dep=33").corps).contains("bonne-cle"), "la clé ne sort jamais");

    let r = get("/api/lieux?q=Pessac");
    assert_eq!((r.code, r.json()[0]["nom"].clone()), (200, json!("<b>Pessac</b>"))); // échappé par la page

    PANNE.lock().unwrap().push("ensemble-api");
    let r = get("/api/ensemble?lat=1&lon=1");
    assert_eq!((r.code, r.json()["detail"].clone()), (502, json!("source.exemple : HTTP 429")), "source en panne : 502 court");
    PANNE.lock().unwrap().clear();
    assert_eq!(get("/api/ensemble?lat=1&lon=1").code, 200, "une erreur ne reste pas en cache");

    *FAUX.lock().unwrap() = Some(illisible);
    let r = get("/api/modeles?lat=2&lon=2");
    assert_eq!((r.code, r.json()["detail"].clone()), (502, json!("api.open-meteo.com : réponse illisible")));
    *FAUX.lock().unwrap() = Some(liste_vide);
    assert_eq!(get("/api/grille?lat=3&lon=3").code, 502, "source au format inattendu");
    *FAUX.lock().unwrap() = Some(faux);

    // Deux demandes simultanées de la même clé : un seul calcul
    static CALCULS: AtomicUsize = AtomicUsize::new(0);
    let fils: Vec<_> = (0..2)
        .map(|_| {
            std::thread::spawn(|| {
                sources::en_cache("essai", 60, || {
                    CALCULS.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(300));
                    Ok(sources::Valeur::Octets(Arc::new(b"valeur".to_vec())))
                })
                .is_ok()
            })
        })
        .collect();
    for f in fils {
        assert!(f.join().unwrap());
    }
    assert_eq!(CALCULS.load(Ordering::SeqCst), 1, "un seul calcul pour deux demandes simultanées");

    let r = get("/api/foudre?lat=44.8&lon=-0.63");
    let f = r.json();
    assert_eq!((r.code, f["impacts"].clone(), f["etat"]["connecte"].clone()), (200, json!([]), json!(false)));

    // --- Tuiles
    assert_eq!(get("/api/radar").json(), json!({"images": [1793209800], "zoom_max": 7}));
    let r = get("/tuiles/radar/1793209800/6/31/22.png");
    assert_eq!((r.code, r.corps.as_slice()), (200, &b"PNG:https://tiles.exemple/v2/radar/abc/256/6/31/22/2/1_1.png"[..]));
    assert_eq!(get("/tuiles/radar/1793209000/6/31/22.png").code, 404, "heure absente de la liste");
    assert_eq!(get("/tuiles/radar/1793209800/8/31/22.png").code, 404, "zoom > 7");
    assert_eq!(get("/tuiles/radar/1793209800/2/4/0.png").code, 404, "x hors de la carte");
    assert_eq!(get("/tuiles/osm/../../serveur.py").code, 404, "chemin bizarre");

    let r = get("/tuiles/osm/7/63/45.png");
    assert_eq!((r.code, r.corps.as_slice()), (200, &b"PNG:https://tile.openstreetmap.org/7/63/45.png"[..]));
    let tuile_disque = tmp.join("cache").join("osm").join("7").join("63").join("45.png");
    assert!(tuile_disque.is_file(), "osm : rangée sur disque");
    let avant = appels();
    get("/tuiles/osm/7/63/45.png");
    assert_eq!(appels(), avant, "osm : relue depuis le disque");
    std::fs::File::options().write(true).open(&tuile_disque).unwrap().set_modified(std::time::UNIX_EPOCH).unwrap(); // périmée
    PANNE.lock().unwrap().push("openstreetmap");
    assert_eq!(get("/tuiles/osm/7/63/45.png").code, 200, "osm : périmée mais OSM en panne, servie quand même");
    assert_eq!(get("/tuiles/osm/7/63/46.png").code, 502, "osm : absente et OSM en panne");
    PANNE.lock().unwrap().clear();
    assert_eq!(get("/tuiles/osm/14/0/0.png").code, 404, "osm : zoom > 13");

    srv.arreter();
    let _ = std::fs::remove_dir_all(&tmp);
}
