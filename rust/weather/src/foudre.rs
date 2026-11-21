//! Impacts de foudre en temps réel : flux websocket public de Blitzortung.org.
//!
//! Le websocket (tungstenite, chiffré par rustls), le décodage LZW des trames Blitzortung, et un
//! tampon des impacts des deux dernières heures, pour le monde entier (environ 200/min, quelques
//! Mo). Le serveur filtre par distance à chaque requête de la page.
//!
//! Protocole non documenté officiellement (repris de clients open source) : se connecter, envoyer
//! {"a":111}, recevoir des trames JSON compressées en LZW. Conditions : usage non commercial,
//! données CC BY-SA 4.0, source citée, relais par notre serveur (jamais depuis le navigateur).

use std::collections::{HashMap, VecDeque};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::protocol::WebSocketConfig;
use tungstenite::Message;

pub const HOTES: [&str; 3] = ["ws1.blitzortung.org", "ws7.blitzortung.org", "ws8.blitzortung.org"];
pub const DUREE_TAMPON: i64 = 2 * 3600; // secondes d'impacts gardés
const TRAME_MAX: usize = 1 << 20; // une trame Blitzortung fait quelques centaines d'octets

/// (temps en ms, lat, lon)
pub type Impact = (i64, f64, f64);

/// Décompresse une trame Blitzortung (LZW sur les caractères, dictionnaire à partir de 256).
pub fn decoder_lzw(texte: &str) -> String {
    let mut cars = texte.chars();
    let Some(premier) = cars.next() else { return String::new() };
    let mut dico: HashMap<u32, String> = HashMap::new();
    let mut courant = premier;
    let mut precedent = premier.to_string();
    let mut sortie = precedent.clone();
    let mut code = 256u32;
    for car in cars {
        let n = car as u32;
        let mot = if n < 256 {
            car.to_string()
        } else if let Some(m) = dico.get(&n) {
            m.clone()
        } else {
            format!("{precedent}{courant}")
        };
        sortie.push_str(&mot);
        courant = mot.chars().next().unwrap_or(courant);
        dico.insert(code, format!("{precedent}{courant}"));
        code += 1;
        precedent = mot;
    }
    sortie
}

/// Un nombre JSON, ou un texte qui en contient un (float() de Python).
fn nombre(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// L'impact d'une trame (pas encore décodée), ou None si elle est illisible.
pub fn impact(texte: &str) -> Option<Impact> {
    let d: Value = serde_json::from_str(&decoder_lzw(texte)).ok()?;
    let (lat, lon) = (nombre(d.get("lat")?)?, nombre(d.get("lon")?)?);
    let t = d.get("time")?;
    let ns = match t {
        Value::String(s) => s.trim().parse::<i64>().ok()?,
        _ => t.as_i64().or_else(|| t.as_f64().filter(|f| f.is_finite()).map(|f| f as i64))?,
    };
    if !((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)) {
        return None;
    }
    Some((ns.div_euclid(1_000_000), lat, lon)) // ns -> ms
}

pub fn distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = std::f64::consts::PI / 180.0;
    let a = ((lat2 - lat1) * r / 2.0).sin().powi(2)
        + (lat1 * r).cos() * (lat2 * r).cos() * ((lon2 - lon1) * r / 2.0).sin().powi(2);
    12742.0 * a.min(1.0).sqrt().asin()
}

pub fn maintenant_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

struct Etat {
    impacts: VecDeque<Impact>,
    connecte: bool,
    derniere: Option<Instant>, // heure de la dernière trame reçue
    erreur: String,
}

/// Garde les impacts des deux dernières heures ; se reconnecte seul.
pub struct Foudre {
    etat: Mutex<Etat>,
}

impl Default for Foudre {
    fn default() -> Self {
        Self::new()
    }
}

impl Foudre {
    pub const fn new() -> Self {
        Foudre { etat: Mutex::new(Etat { impacts: VecDeque::new(), connecte: false, derniere: None, erreur: String::new() }) }
    }

    fn verrou(&self) -> std::sync::MutexGuard<'_, Etat> {
        self.etat.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn ajouter(&self, imp: Impact, maintenant_ms: i64) {
        let mut e = self.verrou();
        e.impacts.push_back(imp);
        let limite = maintenant_ms - DUREE_TAMPON * 1000;
        while e.impacts.front().is_some_and(|i| i.0 < limite) {
            e.impacts.pop_front();
        }
    }

    pub fn tampon(&self) -> usize {
        self.verrou().impacts.len()
    }

    pub fn autour(&self, lat: f64, lon: f64, rayon_km: f64, maintenant_ms: i64) -> Vec<Impact> {
        let limite = maintenant_ms - DUREE_TAMPON * 1000;
        let copie: Vec<Impact> = self.verrou().impacts.iter().copied().collect();
        // Cadre grossier d'abord : la distance exacte ne se calcule que pour les proches
        let dlat = rayon_km / 111.0;
        let dlon = rayon_km / (111.0 * lat.to_radians().cos().max(0.1));
        copie
            .into_iter()
            .filter(|i| {
                i.0 >= limite
                    && (i.1 - lat).abs() <= dlat
                    && (i.2 - lon).abs() <= dlon
                    && distance_km(lat, lon, i.1, i.2) <= rayon_km
            })
            .collect()
    }

    pub fn etat(&self) -> Value {
        let e = self.verrou();
        json!({
            "connecte": e.connecte,
            "derniere_trame_s": e.derniere.map(|d| d.elapsed().as_secs_f64().round_ties_even() as i64),
            "erreur": e.erreur,
            "tampon": e.impacts.len(),
        })
    }

    /// Une connexion à `hote`, jusqu'à sa fin. `pause` revient à 5 s sur une vraie trame.
    fn ecouter(&self, hote: &str, pause: &mut u64) -> Result<(), String> {
        let adresses: Vec<_> = (hote, 443).to_socket_addrs().map_err(|e| e.to_string())?.collect();
        let mut tcp = Err("adresse introuvable".to_string());
        for a in &adresses {
            tcp = TcpStream::connect_timeout(a, Duration::from_secs(15)).map_err(|e| e.to_string());
            if tcp.is_ok() {
                break;
            }
        }
        let tcp = tcp?;
        let delai = |s: u64| -> Result<(), String> {
            tcp.set_read_timeout(Some(Duration::from_secs(s))).map_err(|e| e.to_string())?;
            tcp.set_write_timeout(Some(Duration::from_secs(s))).map_err(|e| e.to_string())
        };
        delai(15)?;
        let mut req = format!("wss://{hote}/").into_client_request().map_err(|e| e.to_string())?;
        req.headers_mut().insert("Origin", HeaderValue::from_static("https://map.blitzortung.org"));
        req.headers_mut()
            .insert("User-Agent", HeaderValue::from_static("web_weather (+https://github.com/pilou33620/web_weather)"));
        let mut config = WebSocketConfig::default();
        config.max_frame_size = Some(TRAME_MAX);
        config.max_message_size = Some(TRAME_MAX);
        let flux = tcp.try_clone().map_err(|e| e.to_string())?;
        let (mut ws, _) =
            tungstenite::client_tls_with_config(req, flux, Some(config), None).map_err(|e| e.to_string())?;
        ws.send(Message::Text(r#"{"a":111}"#.into())).map_err(|e| e.to_string())?;
        delai(60)?; // plus d'une minute sans trame : on change d'hôte
        {
            let mut e = self.verrou();
            e.connecte = true;
            e.erreur.clear();
        }
        loop {
            let texte = match ws.read() {
                Ok(Message::Text(t)) => t,
                Ok(Message::Binary(b)) => String::from_utf8_lossy(&b).into_owned(),
                Ok(Message::Close(_)) => return Ok(()),
                Ok(_) => continue, // ping (le pong part seul), pong, trame brute
                Err(tungstenite::Error::ConnectionClosed) => return Ok(()),
                Err(e) => return Err(e.to_string()),
            };
            // Pause remise à zéro sur une vraie trame : un serveur qui accepte puis ferme
            // aussitôt ne nous fait pas reconnecter toutes les 5 s
            *pause = 5;
            self.verrou().derniere = Some(Instant::now());
            if let Some(imp) = impact(&texte) {
                self.ajouter(imp, maintenant_ms());
            }
        }
    }

    /// Boucle sans fin (fil d'arrière-plan) : un hôte après l'autre, pause croissante.
    fn tourner(&self) {
        // shortcut: rustls doit connaître son fournisseur (ring) ; déjà posé ailleurs, l'erreur est sans effet
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (mut pause, mut n) = (5u64, 0usize);
        loop {
            let hote = HOTES[n % HOTES.len()];
            if let Err(e) = self.ecouter(hote, &mut pause) {
                self.verrou().erreur = format!("{hote} : {e}");
            }
            self.verrou().connecte = false;
            n += 1;
            std::thread::sleep(Duration::from_secs(pause));
            pause = (pause * 2).min(300);
        }
    }

    pub fn demarrer(&'static self) {
        let _ = std::thread::Builder::new().name("foudre".into()).spawn(move || self.tourner());
    }
}

#[cfg(test)]
mod essais {
    use super::*;

    /// Compresseur de référence, pour vérifier le décodeur.
    fn lzw(texte: &str) -> String {
        let mut dico: HashMap<String, u32> = (0..256u32).map(|i| (char::from_u32(i).unwrap().to_string(), i)).collect();
        let (mut w, mut sortie, mut code) = (String::new(), Vec::new(), 256u32);
        for c in texte.chars() {
            let wc = format!("{w}{c}");
            if dico.contains_key(&wc) {
                w = wc;
            } else {
                sortie.push(dico[&w]);
                dico.insert(wc, code);
                code += 1;
                w = c.to_string();
            }
        }
        if !w.is_empty() {
            sortie.push(dico[&w]);
        }
        sortie.into_iter().map(|c| char::from_u32(c).unwrap()).collect()
    }

    #[test]
    fn lzw_et_impacts() {
        let trame = json!({"time": 1793209800123456789i64, "lat": 44.8, "lon": -0.63, "alt": 0, "pol": 0,
            "sig": [{"sta": 1, "time": 1, "lat": 44.8, "lon": -0.6}, {"sta": 1, "time": 1, "lat": 44.8, "lon": -0.6},
                    {"sta": 1, "time": 1, "lat": 44.8, "lon": -0.6}]})
        .to_string();
        assert_eq!(decoder_lzw(&lzw(&trame)), trame);
        assert_eq!(decoder_lzw(&lzw("abababababab")), "abababababab"); // cas « code pas encore au dico »
        assert_eq!(decoder_lzw(""), "");
        assert_eq!(impact(&lzw(&trame)), Some((1793209800123, 44.8, -0.63)));
        assert_eq!(impact("pas du json"), None);
        assert_eq!(impact(&lzw(r#"{"time": 1, "lat": 95, "lon": 0}"#)), None);
    }

    #[test]
    fn tampon_et_distance() {
        let (f, t0) = (Foudre::new(), 10_000_000_000i64);
        f.ajouter((t0 - 3 * 3600 * 1000, 44.8, -0.6), t0);
        f.ajouter((t0 - 60_000, 44.9, -0.6), t0); // 11 km
        f.ajouter((t0 - 60_000, 48.85, 2.35), t0); // Paris, 500 km
        assert_eq!(f.tampon(), 2); // le vieil impact est sorti
        let proches: Vec<f64> = f.autour(44.8, -0.63, 300.0, t0).iter().map(|i| i.1).collect();
        assert_eq!(proches, vec![44.9]);
        assert!((distance_km(0.0, 0.0, 1.0, 0.0) - 111.19).abs() < 0.1);
        assert_eq!(f.etat()["connecte"], false);
        assert_eq!(f.etat()["derniere_trame_s"], Value::Null);
    }
}
