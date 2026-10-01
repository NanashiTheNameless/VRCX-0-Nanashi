use super::*;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[test]
fn local_exception_only_covers_loopback_and_private_addresses() {
    for host in [
        "localhost",
        "api.localhost",
        "localhost.",
        "127.0.0.1",
        "127.3.2.1",
        "10.1.2.3",
        "172.16.1.2",
        "192.168.1.2",
        "169.254.1.2",
        "[::1]",
        "[fd00::12]",
        "[fe80::1]",
        "[::ffff:192.168.1.2]",
    ] {
        assert!(
            is_local(&Url::parse(&format!("http://{host}/")).unwrap()),
            "{host}"
        );
    }
    for host in [
        "localhost.example.com",
        "example.local",
        "example.com",
        "8.8.8.8",
        "172.32.0.1",
        "0.0.0.0",
        "[::]",
        "[2606:4700::1111]",
        "[::ffff:8.8.8.8]",
    ] {
        assert!(
            !is_local(&Url::parse(&format!("https://{host}/")).unwrap()),
            "{host}"
        );
    }
}

async fn serve(response: String) -> (SocketAddr, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let read = tokio::time::timeout(Duration::from_secs(3), stream.read(&mut chunk))
                .await
                .unwrap()
                .unwrap();
            request.extend_from_slice(&chunk[..read]);
            if read == 0 || request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                break;
            }
        }
        if !request.is_empty() {
            stream.write_all(response.as_bytes()).await.unwrap();
        }
        String::from_utf8(request).unwrap()
    });
    (addr, task)
}

fn ok() -> String {
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".into()
}

#[tokio::test]
async fn local_sensitive_post_uses_http1_when_needed() {
    let (addr, server) = serve(ok()).await;
    let response = builder()
        .no_proxy()
        .build()
        .unwrap()
        .post(format!("http://{addr}/chat"))
        .bearer_auth("local-secret")
        .body("prompt")
        .send_with_policy(Policy::sensitive(false))
        .await
        .unwrap();
    assert_eq!(response.version(), Version::HTTP_11);
    assert_eq!(response.text().await.unwrap(), "ok");
    let request = server.await.unwrap();
    assert!(request.starts_with("POST /chat HTTP/1.1"));
    assert!(request.contains("Bearer local-secret"));
}

#[tokio::test]
async fn remote_sensitive_request_never_sends_credentials_over_http1() {
    let (addr, server) = serve(ok()).await;
    let client = builder()
        .no_proxy()
        .resolve("remote.test.invalid", addr)
        .build()
        .unwrap();
    let result = client
        .post(format!("http://remote.test.invalid:{}/chat", addr.port()))
        .bearer_auth("remote-secret")
        .body("private prompt")
        .send_with_policy(Policy::sensitive(false))
        .await;
    assert!(result.is_err());
    assert!(server.await.unwrap().is_empty());
}

#[tokio::test]
async fn local_proxy_does_not_exempt_remote_sensitive_traffic() {
    let (addr, server) = serve(ok()).await;
    let client = builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://{addr}")).unwrap())
        .build()
        .unwrap();
    let result = client
        .post("http://remote.test.invalid/chat")
        .bearer_auth("remote-secret")
        .body("private prompt")
        .send_with_policy(Policy::sensitive(true))
        .await;
    assert!(result.is_err());
    assert!(server.await.unwrap().is_empty());
}

#[tokio::test]
async fn public_remote_request_can_use_http1() {
    let (addr, server) = serve(ok()).await;
    let client = builder()
        .no_proxy()
        .resolve("remote.test.invalid", addr)
        .build()
        .unwrap();
    let response = client
        .get(format!("http://remote.test.invalid:{}/public", addr.port()))
        .send_with_policy(Policy::public())
        .await
        .unwrap();
    assert_eq!(response.version(), Version::HTTP_11);
    assert_eq!(response.text().await.unwrap(), "ok");
    assert!(server.await.unwrap().starts_with("GET /public HTTP/1.1"));
}

#[tokio::test]
async fn redirect_from_local_to_remote_rechecks_protocol_requirement() {
    let (destination, destination_server) = serve(ok()).await;
    let (source, source_server) = serve(format!(
        "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://remote.test.invalid:{}/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", destination.port()
    )).await;
    let client = builder()
        .no_proxy()
        .resolve("remote.test.invalid", destination)
        .build()
        .unwrap();
    let result = client
        .post(format!("http://{source}/redirect"))
        .bearer_auth("secret")
        .body("private prompt")
        .send_with_policy(Policy::sensitive(false))
        .await;
    assert!(result.is_err());
    assert!(source_server.await.unwrap().contains("Bearer secret"));
    assert!(destination_server.await.unwrap().is_empty());
}

#[tokio::test]
async fn cross_origin_redirect_strips_credentials_and_converts_post() {
    let (destination, destination_server) = serve(ok()).await;
    let (source, source_server) = serve(format!(
        "HTTP/1.1 303 See Other\r\nLocation: http://{destination}/result\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )).await;
    let client = builder().no_proxy().build().unwrap();
    let response = client
        .post(format!("http://{source}/submit"))
        .bearer_auth("secret")
        .header("cookie", "auth=secret")
        .header("x-api-key", "secret")
        .body("private prompt")
        .send_with_policy(Policy::sensitive(false))
        .await
        .unwrap();
    assert_eq!(response.text().await.unwrap(), "ok");
    assert!(source_server
        .await
        .unwrap()
        .starts_with("POST /submit HTTP/1.1"));
    let redirected = destination_server.await.unwrap();
    assert!(redirected.starts_with("GET /result HTTP/1.1"));
    assert!(!redirected.contains("secret"));
    assert!(!redirected.contains("private prompt"));
}

#[tokio::test]
async fn no_redirect_policy_preserves_redirect_response() {
    let (addr, server) = serve("HTTP/1.1 302 Found\r\nLocation: http://unreachable.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()).await;
    let response = builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!("http://{addr}/"))
        .send_with_policy(Policy::sensitive(false).without_redirects())
        .await
        .unwrap();
    assert_eq!(response.status(), 302);
    server.await.unwrap();
}

#[tokio::test]
async fn explicit_proxy_skips_direct_http3_probe() {
    assert!(!supports_h3(&Url::parse("https://unresolvable.invalid/").unwrap(), true).await);
}

fn test_tls() -> (rustls::ServerConfig, reqwest::Certificate) {
    let certified = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
    let certificate = reqwest::Certificate::from_der(certified.cert.der()).unwrap();
    let key = rustls::pki_types::PrivatePkcs8KeyDer::from(certified.signing_key.serialize_der());
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(vec![certified.cert.der().clone()], key.into())
    .unwrap();
    (config, certificate)
}

async fn serve_h2(config: rustls::ServerConfig) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let mut config = config;
    config.alpn_protocols = vec![b"h2".to_vec()];
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let stream = acceptor.accept(stream).await.unwrap();
        let mut connection = h2::server::handshake(stream).await.unwrap();
        let (_, mut respond) = connection.accept().await.unwrap().unwrap();
        let mut stream = respond
            .send_response(http::Response::new(()), false)
            .unwrap();
        stream
            .send_data(bytes::Bytes::from_static(b"ok"), true)
            .unwrap();
        while connection.accept().await.is_some() {}
    });
    (addr, server)
}

#[tokio::test]
async fn unavailable_http3_falls_back_to_negotiated_http2() {
    let (config, certificate) = test_tls();
    let (addr, server) = serve_h2(config).await;
    let client = builder()
        .no_proxy()
        .tls_certs_only([certificate])
        .resolve("localhost", addr)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let response = client
        .get(format!("https://localhost:{}/", addr.port()))
        .send_with_policy(Policy::sensitive(false))
        .await
        .unwrap();
    assert_eq!(response.version(), Version::HTTP_2);
    assert_eq!(response.text().await.unwrap(), "ok");
    server.abort();
}

#[tokio::test]
async fn http3_probe_and_sensitive_request_use_quic() {
    let (mut config, certificate) = test_tls();
    config.alpn_protocols = vec![b"h3".to_vec()];
    let crypto = quinn::crypto::rustls::QuicServerConfig::try_from(config).unwrap();
    let endpoint = quinn::Endpoint::server(
        quinn::ServerConfig::with_crypto(Arc::new(crypto)),
        "127.0.0.1:0".parse().unwrap(),
    )
    .unwrap();
    let addr = endpoint.local_addr().unwrap();
    let (requests_tx, mut requests_rx) = tokio::sync::mpsc::channel(4);
    let server_endpoint = endpoint.clone();
    let server = tokio::spawn(async move {
        while let Some(incoming) = server_endpoint.accept().await {
            let requests = requests_tx.clone();
            tokio::spawn(async move {
                let connection = incoming.await.unwrap();
                let closer = connection.clone();
                let mut connection = h3::server::Connection::<_, bytes::Bytes>::new(
                    h3_quinn::Connection::new(connection),
                )
                .await
                .unwrap();
                while let Ok(Some(resolver)) = connection.accept().await {
                    let (request, mut stream) = resolver.resolve_request().await.unwrap();
                    let fail = request.uri().path() == "/fail";
                    requests.send(request).await.unwrap();
                    if fail {
                        closer.close(0x102u32.into(), b"test transport failure");
                        break;
                    }
                    stream.send_response(http::Response::new(())).await.unwrap();
                    stream.finish().await.unwrap();
                }
            });
        }
    });
    let client = builder()
        .no_proxy()
        .tls_certs_only([certificate])
        .resolve("localhost", addr)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let origin = format!("https://localhost:{}", addr.port());
    assert!(probe_h3(&client, &origin).await);
    H3_SUPPORT.lock().unwrap().insert(
        origin.clone(),
        Arc::new(tokio::sync::Mutex::new(Some((Instant::now(), true)))),
    );
    let response = client
        .post(format!("{origin}/chat"))
        .bearer_auth("private-key")
        .body("private prompt")
        .send_with_policy(Policy::sensitive(false))
        .await
        .unwrap();
    assert_eq!(response.version(), Version::HTTP_3);
    assert!(response.status().is_success());
    let probe = requests_rx.recv().await.unwrap();
    assert_eq!(probe.method(), Method::HEAD);
    assert!(!probe.headers().contains_key(header::AUTHORIZATION));
    let request = requests_rx.recv().await.unwrap();
    assert_eq!(request.method(), Method::POST);
    assert_eq!(
        request.headers()[header::AUTHORIZATION],
        "Bearer private-key"
    );
    let tcp_listener = TcpListener::bind(addr).await.unwrap();
    let failed = client
        .post(format!("{origin}/fail"))
        .body("never replay this prompt")
        .send_with_policy(Policy::sensitive(false))
        .await;
    assert!(failed.is_err());
    assert_eq!(requests_rx.recv().await.unwrap().uri().path(), "/fail");
    assert!(
        tokio::time::timeout(Duration::from_millis(100), tcp_listener.accept())
            .await
            .is_err()
    );
    endpoint.close(0u32.into(), b"test complete");
    server.abort();
}

#[tokio::test]
async fn failed_cached_http3_get_retries_over_http2() {
    let (config, certificate) = test_tls();
    let (addr, server) = serve_h2(config).await;
    let origin = format!("https://localhost:{}", addr.port());
    H3_SUPPORT.lock().unwrap().insert(
        origin.clone(),
        Arc::new(tokio::sync::Mutex::new(Some((Instant::now(), true)))),
    );
    let client = builder()
        .no_proxy()
        .tls_certs_only([certificate])
        .resolve("localhost", addr)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let response = client
        .get(format!("{origin}/"))
        .send_with_policy(Policy::sensitive(false))
        .await
        .unwrap();
    assert_eq!(response.version(), Version::HTTP_2);
    assert_eq!(response.text().await.unwrap(), "ok");
    server.abort();
}
