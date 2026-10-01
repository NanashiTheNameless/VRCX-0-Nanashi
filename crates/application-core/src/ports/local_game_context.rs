#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum LocalGameContextSnapshot {
    #[default]
    Unavailable,
    Available {
        is_game_running: bool,
        location: String,
        destination: String,
        world_name: String,
        player_user_ids: Vec<String>,
    },
}

impl LocalGameContextSnapshot {
    pub const fn is_available(&self) -> bool {
        matches!(self, Self::Available { .. })
    }

    pub const fn is_game_running(&self) -> bool {
        matches!(
            self,
            Self::Available {
                is_game_running: true,
                ..
            }
        )
    }

    pub fn with_game_running(mut self, value: bool) -> Self {
        if let Self::Available {
            is_game_running, ..
        } = &mut self
        {
            *is_game_running = value;
        }
        self
    }
}

pub trait LocalGameContextSource: Send + Sync {
    fn snapshot(&self) -> LocalGameContextSnapshot;
}

#[derive(Default)]
pub struct UnavailableLocalGameContextSource;

impl LocalGameContextSource for UnavailableLocalGameContextSource {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        LocalGameContextSnapshot::Unavailable
    }
}
