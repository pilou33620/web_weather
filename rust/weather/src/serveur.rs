//! Le serveur local de web_weather : sert la page (index.html, sw.js, manifest.json, css/, js/,
//! vendor/), l'API (sources.rs) et les tuiles radar et OSM. Lecture seule : aucune route n'écrit.
//!
//! Lancement :  weather            (puis ouvrir http://127.0.0.1:8792)
//! Options   :  --port 8792  --local  --sans-navigateur  --sans-pause  --sans-maj
//! Sans --local, le serveur écoute sur le réseau local et Tailscale ; l'appairage des web tools
//! (web_tools_commun) protège l'accès.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use web_tools_commun::appairage::{self, Garde};
use web_tools_commun::serveur::{decoder_chemin, Reponse, Requete, Serveur};

use crate::sources::{self, racine, Erreur};

pub const PORT: u16 = 8792;

static GARDE: OnceLock<Garde> = OnceLock::new();

fn garde() -> &'static Garde {
    GARDE.get().expect("garde non initialisée")
}

/// Ce que la page charge, et rien d'autre du dossier (ni .git/, ni Cargo.toml, ni rust/, ni cache/).
fn statique_permis(chemin: &str) -> bool {
    if ["/", "/index.html", "/sw.js", "/manifest.json"].iter().any(|c| chemin.eq_ignore_ascii_case(c)) {
        return true;
    }
    let mut segments = chemin.split('/').skip(1);
    let premier = segments.next().unwrap_or("");
    let reste: Vec<&str> = segments.collect();
    let segment_sur = |s: &&str| {
        let mut cars = s.chars();
        cars.next().is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-')
            && cars.all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
    };
    ["css", "js", "vendor"].iter().any(|d| premier.eq_ignore_ascii_case(d)) && !reste.is_empty() && reste.iter().all(segment_sur)
}

/// Les extensions de la page (les tuiles PNG ont leur route) ; une autre est un 404.
fn type_mime(p: &Path) -> Option<&'static str> {
    Some(match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Un fichier de la page ; rien d'autre.
fn fichier(chemin: &str) -> Reponse {
    let chemin = decoder_chemin(chemin);
    let introuvable = || Reponse::texte(404, "File not found");
    if !statique_permis(&chemin) {
        return introuvable();
    }
    let rel = if chemin == "/" { "index.html" } else { chemin.trim_start_matches('/') };
    let f = rel.split('/').fold(racine().to_path_buf(), |p, s| p.join(s));
    let Some(mime) = type_mime(&f) else { return introuvable() };
    if !f.is_file() {
        return introuvable();
    }
    match std::fs::read(&f) {
        Ok(o) => Reponse::new(200, mime, o),
        Err(_) => introuvable(),
    }
}

/// /tuiles/osm/z/x/y.png ou /tuiles/radar/<heure>/z/x/y.png : (heure, z, x, y).
fn tuile(chemin: &str) -> Option<(Option<i64>, u32, u64, u64)> {
    let chiffres = |s: &str, min: usize, max: usize| (min..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
    let tout: Vec<&str> = chemin.strip_prefix("/tuiles/")?.strip_suffix(".png")?.split('/').collect();
    let (heure, p) = match (tout.first().copied(), tout.len()) {
        (Some("osm"), _) => (None, &tout[1..]),
        (Some("radar"), 5) if chiffres(tout[1], 9, 11) => (Some(tout[1].parse::<i64>().ok()?), &tout[2..]),
        _ => return None,
    };
    if p.len() != 3 || !chiffres(p[0], 1, 2) || !chiffres(p[1], 1, 6) || !chiffres(p[2], 1, 6) {
        return None;
    }
    Some((heure, p[0].parse().ok()?, p[1].parse().ok()?, p[2].parse().ok()?))
}

fn erreur(e: Erreur) -> Reponse {
    match e {
        Erreur::Parametre => Reponse::json(400, &json!({"detail": "Paramètres invalides"})),
        Erreur::Source(m) => Reponse::json(502, &json!({"detail": m})),
        Erreur::Format => Reponse::json(502, &json!({"detail": "Réponse inattendue d'une source"})),
    }
}

fn servir(r: &mut Requete) -> Reponse {
    // Host, Internet, TLS, jeton : avant tout traitement de la requête
    if let Some(rep) = garde().filtrer(r) {
        return rep;
    }
    let chemin = r.chemin().to_string();
    if r.methode == "HEAD" {
        return fichier(&chemin);
    }
    if r.methode != "GET" {
        return Reponse::texte(501, "Unsupported method"); // aucune route n'écrit
    }
    if chemin == "/favicon.ico" {
        return Reponse::new(204, "text/plain", Vec::new());
    }
    let q = r.requete().to_string();
    let traiter = || -> Option<Reponse> {
        if let Some(res) = sources::api(&chemin, &q) {
            return Some(match res {
                Ok(v) => Reponse::json(200, &v),
                Err(e) => erreur(e),
            });
        }
        let (heure, z, x, y) = tuile(&chemin)?;
        let corps = match heure {
            Some(t) => sources::tuile_radar(t, z, x, y),
            None => sources::tuile_osm(z, x, y),
        };
        Some(match corps {
            Ok(Some(o)) => Reponse::new(200, "image/png", o.to_vec()),
            Ok(None) => Reponse::json(404, &json!({"detail": "Tuile inconnue"})),
            Err(e) => erreur(e),
        })
    };
    // Une source au format imprévu qui ferait paniquer le calcul : 500, le serveur reste en vie
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(traiter)) {
        Ok(Some(rep)) => rep,
        Ok(None) => fichier(&chemin),
        Err(_) => Reponse::json(500, &json!({"detail": "Erreur interne"})),
    }
}

/// Toutes les réponses : en-têtes de sécurité, et le journal des requêtes qui ne sont pas
/// de simples réussites (les pages, API et tuiles servies ne le remplissent pas).
pub fn repondre(r: &mut Requete) -> Reponse {
    let (methode, cible, client) = (r.methode.clone(), r.cible.clone(), r.client.ip());
    let mut rep = servir(r);
    rep.entetes.retain(|(k, _)| !k.eq_ignore_ascii_case("Cache-Control"));
    // X-Frame-Options: SAMEORIGIN est posé par le serveur commun sur chaque réponse
    let rep = rep
        .entete("Cache-Control", "no-store, max-age=0")
        .entete("Content-Security-Policy", "frame-ancestors 'self'")
        .entete("X-Content-Type-Options", "nosniff");
    if !((methode == "GET" || methode == "HEAD") && (rep.code == 200 || rep.code == 204)) {
        eprintln!("{client} - - [{}] \"{methode} {}\" {}", appairage::heure(), appairage::masquer(&cible), rep.code);
    }
    rep
}

// ---------------------------------------------------------------------- lancement

#[derive(Debug, Default, PartialEq)]
pub struct Args {
    pub port: u16,
    pub local: bool,
    pub sans_navigateur: bool,
    pub sans_pause: bool,
    pub sans_maj: bool,
    pub aide: bool,
}

pub const USAGE: &str = "usage: weather [--port 8792] [--local] [--sans-navigateur] [--sans-pause] [--sans-maj]";

pub fn lire_args(argv: &[String]) -> Result<Args, String> {
    let mut a = Args { port: PORT, ..Default::default() };
    let mut i = 0;
    while i < argv.len() {
        let x = argv[i].as_str();
        let (cle, val) = match x.split_once('=') {
            Some((k, v)) => (k, Some(v.to_string())),
            None => (x, None),
        };
        match cle {
            "--port" => {
                let v = match val {
                    Some(v) => v,
                    None => {
                        i += 1;
                        argv.get(i).cloned().ok_or("--port attend un nombre")?
                    }
                };
                a.port = v.trim().parse().map_err(|_| format!("port invalide : {v}"))?;
            }
            "--local" if val.is_none() => a.local = true,
            "--sans-navigateur" if val.is_none() => a.sans_navigateur = true,
            "--sans-pause" if val.is_none() => a.sans_pause = true,
            "--sans-maj" if val.is_none() => a.sans_maj = true,
            "-h" | "--help" if val.is_none() => a.aide = true,
            _ => return Err(format!("option inconnue : {x}")),
        }
        i += 1;
    }
    Ok(a)
}

fn ouvrir_navigateur(url: &str) {
    let r = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    if r.is_err() {
        println!("Ouvrez {url} dans votre navigateur.");
    }
}

/// Une commande git dans la racine, avec un délai : au-delà, elle est arrêtée.
fn git(args: &[&str], delai: u64) -> Result<String, String> {
    let mut enfant = Command::new("git")
        .args(args)
        .current_dir(racine())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let fin = Instant::now() + Duration::from_secs(delai);
    loop {
        match enfant.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < fin => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = enfant.kill();
                let _ = enfant.wait();
                return Err(format!("git {} : délai de {delai} s dépassé", args.first().unwrap_or(&"")));
            }
        }
    }
    let o = enfant.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
        Err(if err.is_empty() { String::from_utf8_lossy(&o.stdout).trim().to_string() } else { err })
    }
}

/// Mise à jour par git (avance rapide seulement). Rend vrai si le code a changé.
/// Tout échec mène à « on démarre avec la version actuelle ».
fn mise_a_jour() -> bool {
    if git(&["rev-parse", "--is-inside-work-tree"], 5).is_err() {
        return false; // pas de git, ou pas un dépôt : rien d'inquiétant à dire
    }
    println!("[*] Recherche de mises a jour sur GitHub...");
    if let Err(e) = git(&["fetch", "--quiet", "origin"], 10) {
        println!("[!] Impossible de contacter GitHub ({e}).");
        println!("[*] Demarrage normal de l'outil...");
        return false;
    }
    let amont = if git(&["rev-parse", "--verify", "@{u}"], 5).is_ok() {
        "@{u}"
    } else if git(&["rev-parse", "--verify", "origin/main"], 5).is_ok() {
        "origin/main"
    } else {
        return false; // aucune branche amont connue
    };
    let plage = format!("HEAD..{amont}");
    let n: u32 = match git(&["rev-list", plage.as_str(), "--count"], 5).map(|s| s.parse()) {
        Ok(Ok(n)) => n,
        _ => return false,
    };
    if n == 0 {
        println!("[*] Le logiciel est a jour.");
        return false;
    }
    println!("\n{}\nMISE A JOUR DISPONIBLE ({n} nouveau(x) commit(s) sur GitHub)\n{}", "=".repeat(60), "=".repeat(60));
    println!("  Application de la mise a jour en cours...");
    let modifie = git(&["status", "--porcelain", "-uno"], 5).map(|s| !s.is_empty()).unwrap_or(false);
    let mut reserve = false;
    if modifie {
        println!("  Modifications locales detectees : mise en reserve temporaire...");
        reserve = git(&["stash", "push", "-m", "Auto-stash WEB_WEATHER avant mise a jour"], 10).is_ok();
    }
    // --ff-only : on n'applique que la suite exacte de ce qu'on a. Un historique distant réécrit
    // (force-push) ou divergent est refusé, jamais fusionné en silence dans le code qu'on va exécuter.
    let fusion = git(&["merge", "--ff-only", "--quiet", amont], 120);
    if reserve {
        println!("  Restauration des modifications locales...");
        if let Err(e) = git(&["stash", "pop"], 10) {
            println!("[!] Vos modifications locales n'ont pas pu etre reappliquees automatiquement :");
            println!("    {e}");
            println!("    Elles sont conservees dans la reserve Git : voir « git stash list », puis « git stash pop » une fois le conflit resolu.");
        }
    }
    if let Err(e) = fusion {
        println!("[!] Echec de l'application de la mise a jour : {e}");
        println!("[*] Poursuite avec la version actuelle...");
        return false;
    }
    println!("\n{}\nMISE A JOUR APPLIQUEE AVEC SUCCES\n{}\n", "=".repeat(60), "=".repeat(60));
    true
}

pub fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match lire_args(&argv) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{USAGE}\nweather: {e}");
            std::process::exit(2);
        }
    };
    if args.aide {
        println!("{USAGE}\nweb_weather : météo orientée orage.");
        return;
    }
    // shortcut: la pause sous Windows (double-clic) est faite par lancer.bat, --sans-pause l'évite
    let _ = std::env::set_current_dir(racine());
    if !args.sans_maj && mise_a_jour() {
        if std::env::var_os("WEB_WEATHER_RELANCEUR").is_some() {
            println!("  Redemarrage automatique de l'outil...");
            std::process::exit(75);
        }
        println!("  Nouvelle version telechargee : relancez l'outil pour en profiter.");
    }
    let reseau = !args.local;
    let srv = match Serveur::ouvrir(args.port, reseau, 10) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Aucun port libre entre {} et {} : {e}", args.port, args.port.saturating_add(9));
            std::process::exit(1);
        }
    };
    let _ = GARDE.set(Garde::new("WEB_WEATHER", reseau, None, None));
    garde().brancher(&srv); // en mode réseau : HTTPS sur le même port
    sources::FOUDRE.demarrer();
    let port = srv.port();
    let url = format!("http://127.0.0.1:{port}/");
    println!("web_weather — météo orientée orage");
    println!("  adresse : {url}");
    if port != args.port {
        println!("  (le port {} était occupé)", args.port);
    }
    if reseau {
        if let Some(ip) = appairage::adresse_reseau() {
            println!("  réseau  : {}   (téléphone, autre poste)", garde().adresse(&ip.to_string(), port));
        }
        if let Some(ip) = appairage::ip_tailscale() {
            println!("  tailscale : {}", garde().adresse(&ip.to_string(), port));
        }
        println!("            l'autre appareil demande une fois le code d'appairage ci-dessous");
        garde().annoncer();
    }
    println!("  Ctrl+C pour arrêter.\n");
    let _ = std::io::stdout().flush();
    if !args.sans_navigateur {
        ouvrir_navigateur(&url);
    }
    srv.servir(Arc::new(repondre));
}

#[cfg(test)]
mod essais;
