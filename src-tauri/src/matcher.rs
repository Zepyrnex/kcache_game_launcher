use crate::types::{CacheEntry, CacheSource, DetectedGame, GameCacheGroup};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use log::debug;
use std::collections::HashMap;

const MATCH_THRESHOLD: f32 = 0.50;

pub struct Matcher {
    matcher: SkimMatcherV2,
}

impl Matcher {
    pub fn new() -> Self {
        Self {
            matcher: SkimMatcherV2::default(),
        }
    }

    pub fn associate(
        &self,
        games: &[DetectedGame],
        caches: &mut Vec<CacheEntry>,
    ) -> (Vec<GameCacheGroup>, Vec<CacheEntry>) {
        let appid_map: HashMap<&str, &DetectedGame> = games
            .iter()
            .filter_map(|g| g.app_id.as_deref().map(|id| (id, g)))
            .collect();

        for cache in caches.iter_mut() {
            let (game_id, game_name, confidence) = self.match_cache(cache, games, &appid_map);
            cache.associated_game_id = game_id;
            cache.associated_game_guess = game_name;
            cache.confidence = confidence;
        }

        let mut game_groups: HashMap<String, Vec<CacheEntry>> = HashMap::new();
        let mut unmatched: Vec<CacheEntry> = Vec::new();

        for cache in caches.iter() {
            if cache.confidence >= MATCH_THRESHOLD {
                if let Some(game_id) = &cache.associated_game_id {
                    game_groups
                        .entry(game_id.clone())
                        .or_default()
                        .push(cache.clone());
                } else {
                    unmatched.push(cache.clone());
                }
            } else {
                unmatched.push(cache.clone());
            }
        }

        let mut seen_ids = std::collections::HashSet::new();
        let mut groups: Vec<GameCacheGroup> = Vec::new();
        for game in games {
            if seen_ids.insert(game.id.clone()) {
                let game_caches = game_groups.remove(&game.id).unwrap_or_default();
                let total_cache_size = game_caches.iter().map(|c| c.size_bytes).sum();
                groups.push(GameCacheGroup {
                    game: game.clone(),
                    caches: game_caches,
                    total_cache_size,
                });
            }
        }

        groups.sort_by(|a, b| b.total_cache_size.cmp(&a.total_cache_size));

        (groups, unmatched)
    }

    fn match_cache(
        &self,
        cache: &CacheEntry,
        games: &[DetectedGame],
        appid_map: &HashMap<&str, &DetectedGame>,
    ) -> (Option<String>, Option<String>, f32) {
        let path_lower = cache.path.to_lowercase();

        if cache.source == CacheSource::SteamShaderPrecache {
            if let Some(app_id) = &cache.associated_game_id {
                if let Some(game) = appid_map.get(app_id.as_str()) {
                    debug!(
                        "[Matcher] Steam exact match: {} → {}",
                        cache.path, game.name
                    );
                    return (Some(game.id.clone()), Some(game.name.clone()), 1.0);
                }
            }
        }

        for game in games {
            if game.install_path.is_empty() {
                continue;
            }
            let install_lower = game.install_path.to_lowercase();
            if path_lower.starts_with(&install_lower) || install_lower.starts_with(&path_lower) {
                debug!("[Matcher] Path containment: {} → {}", cache.path, game.name);
                return (Some(game.id.clone()), Some(game.name.clone()), 0.85);
            }
        }

        let query = cache
            .associated_game_guess
            .as_deref()
            .unwrap_or("")
            .to_lowercase();

        if query.len() < 3 {
            return (None, None, 0.0);
        }

        let mut best_score: i64 = 0;
        let mut best_game: Option<&DetectedGame> = None;

        for game in games {
            let name_lower = game.name.to_lowercase();
            if let Some(score) = self.matcher.fuzzy_match(&name_lower, &query) {
                if score > best_score {
                    best_score = score;
                    best_game = Some(game);
                }
            }
        }

        if let Some(game) = best_game {
            let confidence = (best_score as f32 / 200.0).clamp(0.0, 0.95);
            debug!(
                "[Matcher] Fuzzy match: '{}' → '{}' (score={}, confidence={:.2})",
                query, game.name, best_score, confidence
            );
            if confidence >= MATCH_THRESHOLD {
                return (Some(game.id.clone()), Some(game.name.clone()), confidence);
            }
        }

        (None, None, 0.0)
    }
}

impl Default for Matcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matcher_steam_exact_match() {
        let matcher = Matcher::new();
        let games = vec![DetectedGame {
            id: "steam_480".to_string(),
            name: "Spacewar".to_string(),
            platform: crate::types::GamePlatform::Steam,
            install_path: "C:\\Games\\Spacewar".to_string(),
            exe_path: None,
            app_id: Some("480".to_string()),
            last_played: None,
            icon_url: None,
            cover_url: None,
            hero_url: None,
            logo_url: None,
            description: None,
            genres: vec![],
            developer: None,
            publisher: None,
            release_date: None,
            playtime_seconds: 0,
            install_size_bytes: 0,
        }];

        let mut caches = vec![CacheEntry {
            id: "c1".to_string(),
            source: CacheSource::SteamShaderPrecache,
            path: "C:\\Steam\\steamapps\\shadercache\\480".to_string(),
            size_bytes: 1024,
            last_modified: 0,
            associated_game_id: Some("480".to_string()),
            associated_game_guess: None,
            confidence: 0.0,
        }];

        let (groups, unmatched) = matcher.associate(&games, &mut caches);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].game.id, "steam_480");
        assert_eq!(groups[0].caches.len(), 1);
        assert_eq!(groups[0].caches[0].confidence, 1.0);
        assert!(unmatched.is_empty());
    }

    #[test]
    fn test_matcher_path_containment() {
        let matcher = Matcher::new();
        let games = vec![DetectedGame {
            id: "epic_1".to_string(),
            name: "CyberGame".to_string(),
            platform: crate::types::GamePlatform::Epic,
            install_path: "C:\\Games\\CyberGame".to_string(),
            exe_path: None,
            app_id: None,
            last_played: None,
            icon_url: None,
            cover_url: None,
            hero_url: None,
            logo_url: None,
            description: None,
            genres: vec![],
            developer: None,
            publisher: None,
            release_date: None,
            playtime_seconds: 0,
            install_size_bytes: 0,
        }];

        let mut caches = vec![CacheEntry {
            id: "c2".to_string(),
            source: CacheSource::Dxvk,
            path: "C:\\Games\\CyberGame\\CyberGame.dxvk-cache".to_string(),
            size_bytes: 2048,
            last_modified: 0,
            associated_game_id: None,
            associated_game_guess: None,
            confidence: 0.0,
        }];

        let (groups, unmatched) = matcher.associate(&games, &mut caches);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].game.id, "epic_1");
        assert_eq!(groups[0].caches.len(), 1);
        assert_eq!(groups[0].caches[0].confidence, 0.85);
        assert!(unmatched.is_empty());
    }

    #[test]
    fn test_matcher_unmatched() {
        let matcher = Matcher::new();
        let games = vec![];
        let mut caches = vec![CacheEntry {
            id: "c3".to_string(),
            source: CacheSource::Unknown,
            path: "C:\\Random\\Path".to_string(),
            size_bytes: 512,
            last_modified: 0,
            associated_game_id: None,
            associated_game_guess: None,
            confidence: 0.0,
        }];

        let (groups, unmatched) = matcher.associate(&games, &mut caches);
        assert!(groups.is_empty());
        assert_eq!(unmatched.len(), 1);
    }
}
