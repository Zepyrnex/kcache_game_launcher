use log::{debug, info, warn};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct EverythingHttpResponse {
    #[serde(default)]
    results: Vec<EverythingResult>,
    #[serde(default)]
    totalresults: u64,
}

#[derive(Debug, Deserialize)]
struct EverythingResult {
    #[serde(default)]
    path: String,

    #[serde(default)]
    name: String,
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    date_modified: String,
}

pub struct EverythingClient {
    base_url: String,
    port: u16,
    available: Option<bool>,
}

impl EverythingClient {
    pub fn new() -> Self {
        Self {
            base_url: "http://localhost".to_string(),
            port: 80,
            available: None,
        }
    }

    pub fn with_port(port: u16) -> Self {
        Self {
            base_url: "http://localhost".to_string(),
            port,
            available: None,
        }
    }

    fn api_url(&self) -> String {
        if self.port == 80 {
            format!("{}/", self.base_url)
        } else {
            format!("{}:{}/", self.base_url, self.port)
        }
    }

    pub fn is_available(&mut self) -> bool {
        if let Some(cached) = self.available {
            return cached;
        }
        let result = self.ping();
        self.available = Some(result);
        result
    }

    fn ping(&self) -> bool {
        let url = format!("{}?s=everything&json=1&count=1", self.api_url());
        match reqwest::blocking::get(&url) {
            Ok(resp) => {
                let available = resp.status().is_success();
                if available {
                    info!("[Everything] HTTP API available at {}", self.api_url());
                } else {
                    debug!("[Everything] HTTP API returned non-success status");
                }
                available
            }
            Err(e) => {
                debug!("[Everything] HTTP API not reachable: {e}");
                false
            }
        }
    }

    pub fn search(&self, query: &str, max_results: u32) -> Option<Vec<FoundItem>> {
        let url = format!(
            "{}?s={}&json=1&count={}&path_column=1&size_column=1&date_modified_column=1",
            self.api_url(),
            urlencoding::encode(query),
            max_results
        );

        debug!("[Everything] query: {query}");

        let resp = reqwest::blocking::get(&url).ok()?;
        if !resp.status().is_success() {
            return None;
        }

        let body: EverythingHttpResponse = resp.json().ok()?;
        debug!(
            "[Everything] '{}' → {} results (total: {})",
            query,
            body.results.len(),
            body.totalresults
        );

        let items = body
            .results
            .into_iter()
            .map(|r| {
                let full_path = if r.path.is_empty() {
                    r.name.clone()
                } else if r.name.is_empty() {
                    r.path.clone()
                } else {
                    format!("{}\\{}", r.path.trim_end_matches('\\'), r.name)
                };
                FoundItem {
                    full_path: PathBuf::from(&full_path),
                    is_folder: r.kind == "folder",
                    size_bytes: r.size,
                    date_modified_raw: r.date_modified,
                }
            })
            .collect();

        Some(items)
    }

    pub fn find_dxvk_caches(&self) -> Option<Vec<FoundItem>> {
        self.search("ext:dxvk-cache", 5000)
    }

    pub fn find_vkd3d_caches(&self) -> Option<Vec<FoundItem>> {
        self.search("ext:vkd3d-cache", 5000)
    }

    pub fn find_shadercache_folders(&self) -> Option<Vec<FoundItem>> {
        self.search("folder:shadercache", 2000)
    }

    pub fn find_nvidia_caches(&self) -> Option<Vec<FoundItem>> {
        self.search(r"path:NVIDIA\DXCache | path:NVIDIA\GLCache", 200)
    }

    pub fn find_amd_caches(&self) -> Option<Vec<FoundItem>> {
        self.search(r"path:AMD\DxCache | path:AMD\DxcCache", 200)
    }

    pub fn find_intel_caches(&self) -> Option<Vec<FoundItem>> {
        self.search(r"path:Intel\ShaderCache", 200)
    }

    pub fn find_in_path(
        &self,
        path_prefix: &str,
        extension: &str,
        max: u32,
    ) -> Option<Vec<FoundItem>> {
        let query = format!("path:\"{path_prefix}\" ext:{extension}");
        self.search(&query, max)
    }

    pub fn find_executables_in_folder(&self, folder_path: &str) -> Option<Vec<FoundItem>> {
        let clean_path = folder_path.trim_end_matches('\\').trim_end_matches('/');
        let query = format!("path:\"{clean_path}\" ext:exe");
        self.search(&query, 5000)
    }
}

impl Default for EverythingClient {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct FoundItem {
    pub full_path: PathBuf,
    pub is_folder: bool,
    pub size_bytes: u64,
    pub date_modified_raw: String,
}

impl FoundItem {
    pub fn last_modified_unix(&self) -> i64 {
        if let Ok(ts) = self.date_modified_raw.parse::<i64>() {
            return ts;
        }

        self.full_path
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

pub fn find_everything_install() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;

        for (hive, key) in &[
            (HKEY_CURRENT_USER, r"Software\voidtools\Everything"),
            (HKEY_LOCAL_MACHINE, r"Software\voidtools\Everything"),
            (
                HKEY_LOCAL_MACHINE,
                r"Software\WOW6432Node\voidtools\Everything",
            ),
        ] {
            if let Ok(reg) = RegKey::predef(*hive).open_subkey(key) {
                if let Ok(path) = reg.get_value::<String, _>("Installation Folder") {
                    let install = PathBuf::from(path);
                    if install.exists() {
                        info!("[Everything] Found install at: {}", install.display());
                        return Some(install);
                    }
                }
            }
        }
    }
    None
}

pub fn find_everything_http_port() -> Option<u16> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        if let Ok(reg) =
            RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\voidtools\Everything\Settings")
        {
            let enabled: u32 = reg.get_value("http_server_enabled").unwrap_or(0);
            if enabled == 1 {
                let port: u32 = reg.get_value("http_server_port").unwrap_or(80);
                return Some(port as u16);
            }
        }
    }
    None
}

pub fn make_client_from_install() -> Option<EverythingClient> {
    let install = find_everything_install()?;
    let port = find_everything_http_port().unwrap_or(80);
    let mut client = EverythingClient::with_port(port);
    if client.is_available() {
        Some(client)
    } else {
        warn!(
            "[Everything] Installed at {} but HTTP API not reachable on port {port}. \
               User may need to enable: Tools → Options → HTTP Server.",
            install.display()
        );
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_encoding() {
        assert_eq!(urlencoding::encode("hello world"), "hello%20world");
        assert_eq!(urlencoding::encode("ext:dxvk-cache"), "ext%3Adxvk-cache");
    }

    #[test]
    fn test_client_creation() {
        let client = EverythingClient::new();
        assert_eq!(client.port, 80);

        let client2 = EverythingClient::with_port(8080);
        assert_eq!(client2.port, 8080);
        assert_eq!(client2.api_url(), "http://localhost:8080/");
    }
}
