//! web_weather : météo orientée orage. Le navigateur ne parle qu'à ce serveur, qui relaie
//! et garde en cache les sources (sources.rs) et le flux de foudre Blitzortung (foudre.rs).
pub mod foudre;
pub mod serveur;
pub mod sources;
