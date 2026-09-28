//! The process-wide TLS crypto backend. HTTP clients (reqwest) and websockets
//! (tokio-tungstenite) are built without a bundled provider and use this one.

/// Install ring as rustls' process-wide crypto provider. Safe to call any
/// number of times; call it before building an HTTP client or opening a TLS
/// websocket, since neither works without a provider.
pub fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg(test)]
mod tests {
    #[test]
    fn installs_a_provider_and_can_be_called_again() {
        super::install_crypto_provider();
        super::install_crypto_provider();
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
}
