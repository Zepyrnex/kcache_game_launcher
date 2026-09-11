pub mod epic;
pub mod gog;
pub mod steam;

use crate::types::DetectedGame;

pub trait GameLibrary: Send + Sync {
    fn name(&self) -> &'static str;
    fn detect(&self) -> Vec<DetectedGame>;
}
