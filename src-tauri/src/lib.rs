#![allow(
    clippy::too_many_arguments,
    clippy::collapsible_str_replace,
    clippy::collapsible_if,
    clippy::unnecessary_sort_by,
    clippy::ptr_arg,
    clippy::manual_flatten,
    clippy::upper_case_acronyms,
    clippy::unnecessary_unwrap
)]

pub mod backup;
pub mod commands;
pub mod compressor;
pub mod db;
pub mod everything;
pub mod libraries;
pub mod matcher;
pub mod save_manager;
pub mod scanners;
pub mod steam_api;
pub mod types;
pub mod utils;

use commands::AppState;
use db::Database;
use log::info;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    info!("Kcache starting…");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            let _ = std::fs::create_dir_all(&app_dir);

            let db_path = app_dir.join("kcache.db");

            if !db_path.exists() {
                if let Some(roaming) = dirs::config_dir() {
                    let candidates = [
                        roaming.join("com.kcache.app").join("kcache.db"),
                        roaming.join("com.shadervault.app").join("shadervault.db"),
                    ];
                    for old in &candidates {
                        if old.exists() {
                            info!(
                                "Migrating database from {} to {}",
                                old.display(),
                                db_path.display()
                            );
                            let _ = std::fs::copy(old, &db_path);
                            break;
                        }
                    }
                }
            }

            info!("Opening database at {}", db_path.display());

            let db = Database::open(&db_path).expect("Failed to open/initialize database");

            app.manage(AppState {
                db: Mutex::new(db),
                active_session: Mutex::new(std::collections::HashMap::new()),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::run_scan,
            commands::delete_cache,
            commands::restore_from_trash,
            commands::backup_game_cache,
            commands::restore_cache_from_archive,
            commands::get_backups,
            commands::get_trash,
            commands::get_settings,
            commands::set_setting,
            commands::get_everything_status,
            commands::get_scan_folders,
            commands::add_scan_folder,
            commands::remove_scan_folder,
            commands::toggle_scan_folder,
            commands::scan_custom_folders,
            commands::add_custom_games,
            commands::launch_game,
            commands::open_game_folder,
            commands::fetch_steam_metadata,
            commands::search_steam_games,
            commands::update_game_metadata,
            commands::detect_steam_id,
            commands::sync_steam_web_api,
            commands::delete_game,
            commands::get_excluded_games,
            commands::restore_game,
            commands::update_game_exe,
            commands::get_game_disk_size,
            commands::get_game_playtime,
            commands::compress_shader_cache,
            commands::decompress_shader_cache,
            commands::get_vault_entries,
            commands::delete_vault_entry,
            commands::open_vault_folder,
            commands::get_library_statistics,
            save_manager::detect_saves,
            save_manager::backup_saves,
            save_manager::open_save_folder,
            save_manager::open_backup_folder,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Kcache");
}
