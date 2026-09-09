pub mod steam;
pub mod epic;
pub mod gog;

use crate::types::DetectedGame;

pub trait GameLibrary: Send + Sync {
    fn name(&self) -> &'static str;
    fn detect(&self) -> Vec<DetectedGame>;
}
