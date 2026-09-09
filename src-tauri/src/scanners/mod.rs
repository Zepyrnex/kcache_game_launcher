use crate::types::CacheEntry;

pub trait CacheScanner: Send + Sync {
    fn name(&self) -> &'static str;
    fn scan(&self) -> Vec<CacheEntry>;
}

pub mod gpu_drivers;
pub mod steam_cache;
pub mod dxvk;
pub mod exe_scanner;
