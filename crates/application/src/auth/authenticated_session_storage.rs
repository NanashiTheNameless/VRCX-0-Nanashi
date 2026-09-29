use vrcx_0_application_core::Result;

pub trait AuthenticatedSessionStorage: Send + Sync {
    fn ensure_user_scope(&self, user_id: &str) -> Result<()>;
}

pub fn initialize_authenticated_session_storage(
    storage: &dyn AuthenticatedSessionStorage,
    user_id: &str,
) -> Result<()> {
    storage.ensure_user_scope(user_id)
}
