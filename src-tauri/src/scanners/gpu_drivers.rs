use crate::scanners::CacheScanner;
use crate::types::{CacheEntry, CacheSource};
use crate::utils::scan_dir;
use dirs::data_local_dir;

pub struct NvidiaScanner;

impl CacheScanner for NvidiaScanner {
    fn name(&self) -> &'static str {
        "NVIDIA Driver Cache"
    }

    fn scan(&self) -> Vec<CacheEntry> {
        let mut results = Vec::new();
        if let Some(local) = data_local_dir() {
            let nvidia = local.join("NVIDIA");
            for (subdir, source) in &[
                ("DXCache", CacheSource::NvidiaDx),
                ("GLCache", CacheSource::NvidiaGl),
            ] {
                if let Some(entry) = scan_dir(source.clone(), nvidia.join(subdir)) {
                    results.push(entry);
                }
            }
        }
        results
    }
}

pub struct AmdScanner;

impl CacheScanner for AmdScanner {
    fn name(&self) -> &'static str {
        "AMD Driver Cache"
    }

    fn scan(&self) -> Vec<CacheEntry> {
        let mut results = Vec::new();
        if let Some(local) = data_local_dir() {
            let amd = local.join("AMD");
            for (subdir, source) in &[
                ("DxCache", CacheSource::AmdDx),
                ("DxcCache", CacheSource::AmdDxc),
            ] {
                if let Some(entry) = scan_dir(source.clone(), amd.join(subdir)) {
                    results.push(entry);
                }
            }
        }
        results
    }
}

pub struct IntelScanner;

impl CacheScanner for IntelScanner {
    fn name(&self) -> &'static str {
        "Intel Driver Cache"
    }

    fn scan(&self) -> Vec<CacheEntry> {
        let mut results = Vec::new();
        if let Some(local) = data_local_dir() {
            let intel = local.join("Intel").join("ShaderCache");
            if let Some(entry) = scan_dir(CacheSource::IntelShader, intel) {
                results.push(entry);
            }
        }
        results
    }
}
