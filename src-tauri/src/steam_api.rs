use crate::types::{AppError, SteamAppDetails, SteamOwnedGame, SteamSearchResult};
use log::{debug, info};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

pub struct SteamApiClient {
    client: reqwest::blocking::Client,
}

impl SteamApiClient {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .unwrap_or_default();
        Self { client }
    }

    pub fn get_cdn_cover_url(app_id: &str) -> String {
        format!("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_600x900_2x.jpg")
    }

    pub fn get_cdn_hero_url(app_id: &str) -> String {
        format!("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_hero.jpg")
    }

    pub fn get_cdn_logo_url(app_id: &str) -> String {
        format!(
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{app_id}/logo.png"
        )
    }

    pub fn fetch_app_details(&self, app_id: &str) -> Result<SteamAppDetails, AppError> {
        let url =
            format!("https://store.steampowered.com/api/appdetails?appids={app_id}&l=english");
        debug!("[Steam API] Fetching app details: {url}");

        let resp =
            self.client.get(&url).send().map_err(|e| {
                AppError::Other(format!("Failed to connect to Steam Storefront: {e}"))
            })?;

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AppError::Other(
                "Steam Storefront rate limit (429) hit. Please wait a moment.".into(),
            ));
        }

        if !resp.status().is_success() {
            return Err(AppError::Other(format!(
                "Steam Storefront returned status: {}",
                resp.status()
            )));
        }

        let root: Value = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse Steam response: {e}")))?;

        let app_obj = root
            .get(app_id)
            .ok_or_else(|| AppError::Other(format!("App ID {app_id} not found in response")))?;

        let success = app_obj
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !success {
            return Err(AppError::Other(format!(
                "Steam returned unsuccessful for App ID {app_id}"
            )));
        }

        let data = app_obj
            .get("data")
            .ok_or_else(|| AppError::Other("Missing 'data' field in Steam response".into()))?;

        let name = data
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Game")
            .to_string();
        let short_description = data
            .get("short_description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let header_image = data
            .get("header_image")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let capsule_image = data
            .get("capsule_image")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let genres = data
            .get("genres")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| {
                        g.get("description")
                            .and_then(|d| d.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default();

        let developers = data
            .get("developers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|d| d.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let publishers = data
            .get("publishers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| p.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let release_date = data
            .get("release_date")
            .and_then(|v| v.get("date"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let pc_requirements = data.get("pc_requirements");
        let pc_requirements_min = pc_requirements
            .and_then(|v| v.get("minimum"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let pc_requirements_rec = pc_requirements
            .and_then(|v| v.get("recommended"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let cover_url = Self::get_cdn_cover_url(app_id);
        let hero_url = Self::get_cdn_hero_url(app_id);
        let logo_url = Self::get_cdn_logo_url(app_id);

        Ok(SteamAppDetails {
            app_id: app_id.to_string(),
            name,
            short_description,
            header_image,
            capsule_image,
            cover_url,
            hero_url,
            logo_url,
            genres,
            pc_requirements_min,
            pc_requirements_rec,
            developers,
            publishers,
            release_date,
        })
    }

    pub fn search_store(&self, query: &str) -> Result<Vec<SteamSearchResult>, AppError> {
        let encoded_term = urlencoding::encode(query);
        let url = format!(
            "https://store.steampowered.com/api/storesearch/?term={encoded_term}&l=english&cc=US"
        );
        debug!("[Steam API] Store search: {url}");

        let resp = self
            .client
            .get(&url)
            .send()
            .map_err(|e| AppError::Other(format!("Failed to search Steam Store: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Other(format!(
                "Steam search returned status: {}",
                resp.status()
            )));
        }

        #[derive(Deserialize)]
        struct SearchResponse {
            #[serde(default)]
            items: Vec<SearchItem>,
        }

        #[derive(Deserialize)]
        struct SearchItem {
            id: u64,
            name: String,
            #[serde(default)]
            tiny_image: String,
        }

        let search_data: SearchResponse = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse search response: {e}")))?;

        let results = search_data
            .items
            .into_iter()
            .map(|item| {
                let id_str = item.id.to_string();
                SteamSearchResult {
                    id: item.id,
                    name: item.name,
                    tiny_image: item.tiny_image,
                    cover_url: Self::get_cdn_cover_url(&id_str),
                }
            })
            .collect();

        Ok(results)
    }

    pub fn detect_local_steam_id() -> Option<String> {
        let steam_roots = crate::libraries::steam::SteamLibrary::get_library_paths();
        let candidates: Vec<PathBuf> = steam_roots
            .iter()
            .map(|p| p.join("config").join("loginusers.vdf"))
            .collect();

        for vdf_path in candidates {
            if vdf_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&vdf_path) {
                    if let Some(steam_id) = parse_loginusers_vdf(&content) {
                        info!("[Steam API] Detected active Steam ID: {steam_id}");
                        return Some(steam_id);
                    }
                }
            }
        }

        let default_vdf = PathBuf::from(r"C:\Program Files (x86)\Steam\config\loginusers.vdf");
        if default_vdf.exists() {
            if let Ok(content) = std::fs::read_to_string(&default_vdf) {
                if let Some(steam_id) = parse_loginusers_vdf(&content) {
                    return Some(steam_id);
                }
            }
        }

        None
    }

    pub fn fetch_owned_games(
        &self,
        api_key: &str,
        steam_id: &str,
    ) -> Result<Vec<SteamOwnedGame>, AppError> {
        let url = format!(
            "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key={api_key}&steamid={steam_id}&include_appinfo=true&include_played_free_games=true&format=json"
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .map_err(|e| AppError::Other(format!("Steam Web API request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Other(format!(
                "Steam Web API error status: {}",
                resp.status()
            )));
        }

        #[derive(Deserialize)]
        struct WebApiResponse {
            response: OwnedGamesResponse,
        }

        #[derive(Deserialize)]
        struct OwnedGamesResponse {
            #[serde(default)]
            games: Vec<SteamOwnedGameRaw>,
        }

        #[derive(Deserialize)]
        struct SteamOwnedGameRaw {
            appid: u64,
            name: Option<String>,
            #[serde(default)]
            playtime_forever: u64,
            img_icon_url: Option<String>,
        }

        let body: WebApiResponse = resp
            .json()
            .map_err(|e| AppError::Other(format!("Failed to parse GetOwnedGames: {e}")))?;

        let games = body
            .response
            .games
            .into_iter()
            .map(|g| SteamOwnedGame {
                appid: g.appid,
                name: g.name,
                playtime_forever: g.playtime_forever,
                img_icon_url: g.img_icon_url,
            })
            .collect();

        Ok(games)
    }
}

impl Default for SteamApiClient {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_loginusers_vdf(content: &str) -> Option<String> {
    let user_block_re = regex::Regex::new(r#""(7656\d{13,})"\s*\{([^}]+)\}"#).ok()?;
    let most_recent_re = regex::Regex::new(r#""MostRecent"\s*"1""#).ok()?;

    let mut first_id: Option<String> = None;

    for cap in user_block_re.captures_iter(content) {
        let id = cap[1].to_string();
        let block_content = &cap[2];

        if first_id.is_none() {
            first_id = Some(id.clone());
        }

        if most_recent_re.is_match(block_content) {
            return Some(id);
        }
    }

    first_id
}
