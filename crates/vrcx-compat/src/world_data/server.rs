use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use super::{WorldDataService, GLOBAL_WORLD_ID};

/// VRCX's `WorldDataRequestResponse`, field for field.
#[derive(Debug, Serialize, PartialEq, Eq)]
struct WorldDataResponse {
    ok: bool,
    error: Option<String>,
    data: Option<String>,
    #[serde(rename = "statusCode")]
    status_code: u16,
    #[serde(rename = "connectionKey")]
    connection_key: Option<String>,
}

impl WorldDataResponse {
    fn success(data: Option<String>, connection_key: Option<String>) -> Self {
        Self {
            ok: true,
            error: None,
            data,
            status_code: 200,
            connection_key,
        }
    }

    fn error(status_code: u16, error: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(error.into()),
            data: None,
            status_code,
            connection_key: None,
        }
    }
}

impl IntoResponse for WorldDataResponse {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status_code).unwrap_or(StatusCode::OK);
        let body = serde_json::to_string(&self).unwrap_or_else(|_| "{}".into());
        (
            status,
            [
                (header::CONTENT_TYPE, "application/json"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            body,
        )
            .into_response()
    }
}

#[derive(Clone)]
struct ServerContext {
    service: Arc<WorldDataService>,
    port: u16,
}

type Params = Query<HashMap<String, String>>;

pub(super) async fn serve(
    service: Arc<WorldDataService>,
    listener: TcpListener,
    port: u16,
    cancel: CancellationToken,
) {
    let router = Router::new()
        .route("/vrcx/data/init", get(init))
        .route("/vrcx/data/get", get(get_value))
        .route("/vrcx/data/getall", get(get_all))
        .route("/vrcx/data/getbulk", get(get_bulk))
        .route("/vrcx/data/lasterror", get(last_error))
        .route("/vrcx/data/settings", get(settings))
        .route("/vrcx/status", get(status))
        .fallback(not_found)
        .with_state(ServerContext { service, port });
    if let Err(error) = axum::serve(listener, router)
        .with_graceful_shutdown(cancel.cancelled_owned())
        .await
    {
        tracing::warn!(error = %error, "VRCX world data server stopped");
    }
}

/// Worlds reach the server as `127.0.0.1` or `localhost`; any other Host is a
/// web page trying to reach it through DNS rebinding.
fn host_allowed(context: &ServerContext, headers: &HeaderMap) -> bool {
    vrcx_0_local_server::is_allowed_authority(
        vrcx_0_local_server::header_to_str(headers, "host"),
        context.port,
        false,
    )
}

fn forbidden() -> WorldDataResponse {
    WorldDataResponse::error(403, "Requests must be addressed to 127.0.0.1 or localhost.")
}

fn internal(error: String) -> WorldDataResponse {
    WorldDataResponse::error(
        500,
        format!(
            "VRCX-0-Nanashi has encountered an exception while processing the request: {error}"
        ),
    )
}

/// The current world and its connection key, or VRCX's error response.
fn current_world(service: &WorldDataService) -> Result<(String, String), WorldDataResponse> {
    let world_id = service
        .current_world_id()
        .ok_or_else(|| WorldDataResponse::error(500, "Failed to get/verify current world ID."))?;
    let key = service.ensure_world(&world_id).map_err(internal)?;
    Ok((world_id, key))
}

/// VRCX's `world` parameter: `global` switches the returned connection key to
/// the global store's, and another world is only read when it allows it.
enum ReadTarget {
    Own,
    Other(String),
    Refused,
}

fn read_target(
    service: &WorldDataService,
    params: &HashMap<String, String>,
    world_id: &str,
    connection_key: &mut String,
) -> Result<ReadTarget, WorldDataResponse> {
    let Some(requested) = params.get("world") else {
        return Ok(ReadTarget::Own);
    };
    if requested == GLOBAL_WORLD_ID {
        *connection_key = service.ensure_world(GLOBAL_WORLD_ID).map_err(internal)?;
    }
    if requested == world_id {
        return Ok(ReadTarget::Own);
    }
    if service.may_read(requested).map_err(internal)? {
        Ok(ReadTarget::Other(requested.clone()))
    } else {
        Ok(ReadTarget::Refused)
    }
}

fn all_as_json(service: &WorldDataService, world_id: &str) -> Result<String, WorldDataResponse> {
    let entries = service.get_all(world_id).map_err(internal)?;
    let map: serde_json::Map<String, serde_json::Value> = entries
        .into_iter()
        .map(|(key, value)| (key, serde_json::Value::String(value)))
        .collect();
    Ok(serde_json::Value::Object(map).to_string())
}

async fn init(State(context): State<ServerContext>, headers: HeaderMap) -> WorldDataResponse {
    if !host_allowed(&context, &headers) {
        return forbidden();
    }
    match current_world(&context.service) {
        Ok((_, key)) => WorldDataResponse::success(Some(key.clone()), Some(key)),
        Err(response) => response,
    }
}

async fn get_value(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    Query(params): Params,
) -> WorldDataResponse {
    if !host_allowed(&context, &headers) {
        return forbidden();
    }
    let Some(key) = params.get("key") else {
        return WorldDataResponse::error(400, "Missing key parameter.");
    };
    let service = &context.service;
    let (world_id, mut connection_key) = match current_world(service) {
        Ok(current) => current,
        Err(response) => return response,
    };
    let source = match read_target(service, &params, &world_id, &mut connection_key) {
        Ok(ReadTarget::Own) => world_id,
        Ok(ReadTarget::Other(other)) => other,
        Ok(ReadTarget::Refused) => return WorldDataResponse::success(None, Some(connection_key)),
        Err(response) => return response,
    };
    match service.get(&source, key) {
        Ok(value) => WorldDataResponse::success(value, Some(connection_key)),
        Err(error) => internal(error),
    }
}

async fn get_all(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    Query(params): Params,
) -> WorldDataResponse {
    if !host_allowed(&context, &headers) {
        return forbidden();
    }
    let service = &context.service;
    let (world_id, mut connection_key) = match current_world(service) {
        Ok(current) => current,
        Err(response) => return response,
    };
    let source = match read_target(service, &params, &world_id, &mut connection_key) {
        Ok(ReadTarget::Own) => world_id,
        Ok(ReadTarget::Other(other)) => other,
        Ok(ReadTarget::Refused) => return WorldDataResponse::success(None, Some(connection_key)),
        Err(response) => return response,
    };
    match all_as_json(service, &source) {
        Ok(json) => WorldDataResponse::success(Some(json), Some(connection_key)),
        Err(response) => response,
    }
}

async fn get_bulk(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    Query(params): Params,
) -> WorldDataResponse {
    if !host_allowed(&context, &headers) {
        return forbidden();
    }
    let Some(keys) = params.get("keys") else {
        return WorldDataResponse::error(400, "Missing/invalid keys parameter.");
    };
    let service = &context.service;
    let (world_id, mut connection_key) = match current_world(service) {
        Ok(current) => current,
        Err(response) => return response,
    };
    match read_target(service, &params, &world_id, &mut connection_key) {
        Ok(ReadTarget::Own) => {}
        // VRCX answers a bulk read of another world with all of its data.
        Ok(ReadTarget::Other(other)) => {
            return match all_as_json(service, &other) {
                Ok(json) => WorldDataResponse::success(Some(json), Some(connection_key)),
                Err(response) => response,
            };
        }
        Ok(ReadTarget::Refused) => return WorldDataResponse::success(None, Some(connection_key)),
        Err(response) => return response,
    }
    let mut map = serde_json::Map::new();
    for key in keys.split(',') {
        if map.contains_key(key) {
            continue;
        }
        let value = match service.get(&world_id, key) {
            Ok(value) => value,
            Err(error) => return internal(error),
        };
        map.insert(
            key.to_string(),
            value.map_or(serde_json::Value::Null, serde_json::Value::String),
        );
    }
    WorldDataResponse::success(
        Some(serde_json::Value::Object(map).to_string()),
        Some(connection_key),
    )
}

async fn last_error(State(context): State<ServerContext>, headers: HeaderMap) -> WorldDataResponse {
    if !host_allowed(&context, &headers) {
        return forbidden();
    }
    let error = context.service.take_last_error();
    WorldDataResponse {
        ok: error.is_none(),
        error: None,
        data: error,
        status_code: 200,
        connection_key: None,
    }
}

async fn settings(
    State(context): State<ServerContext>,
    headers: HeaderMap,
    Query(params): Params,
) -> WorldDataResponse {
    if !host_allowed(&context, &headers) {
        return forbidden();
    }
    let service = &context.service;
    let (world_id, connection_key) = match current_world(service) {
        Ok(current) => current,
        Err(response) => return response,
    };
    if let (Some(name), Some(value)) = (params.get("set"), params.get("value")) {
        match name.as_str() {
            "externalReads" => {
                let allow = match value.as_str() {
                    "true" => true,
                    "false" => false,
                    _ => {
                        return WorldDataResponse::error(
                            400,
                            "Invalid value for 'externalReads' setting.",
                        )
                    }
                };
                if let Err(error) = service.set_allow_external_read(&world_id, allow) {
                    return internal(error);
                }
            }
            _ => return WorldDataResponse::error(400, "Invalid setting name."),
        }
    }
    WorldDataResponse::success(None, Some(connection_key))
}

async fn status(State(context): State<ServerContext>, headers: HeaderMap) -> Response {
    if !host_allowed(&context, &headers) {
        return forbidden().into_response();
    }
    StatusCode::OK.into_response()
}

async fn not_found() -> WorldDataResponse {
    WorldDataResponse::error(404, "Invalid VRCX endpoint.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn start(world: &'static str) -> (Arc<WorldDataService>, u16, CancellationToken) {
        let service = Arc::new(WorldDataService::in_memory(Arc::new(move || {
            world.to_string()
        })));
        let listener = vrcx_0_local_server::bind_listener(0, false).unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = CancellationToken::new();
        tokio::spawn(serve(Arc::clone(&service), listener, port, cancel.clone()));
        (service, port, cancel)
    }

    async fn request(port: u16, host: &str, path: &str) -> (u16, String) {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        let status = response
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let body = response
            .split_once("\r\n\r\n")
            .map(|(_, body)| body.to_string())
            .unwrap_or_default();
        (status, body)
    }

    fn json(body: &str) -> serde_json::Value {
        serde_json::from_str(body).unwrap()
    }

    #[tokio::test]
    async fn init_and_get_follow_vrcx_responses() {
        let (service, port, cancel) = start("wrld_a").await;
        let host = format!("127.0.0.1:{port}");

        let (status, body) = request(port, &host, "/vrcx/data/init").await;
        assert_eq!(status, 200);
        let body = json(&body);
        let key = body["connectionKey"].as_str().unwrap().to_string();
        assert_eq!(body["data"], key.as_str());
        assert_eq!(body["ok"], true);
        assert_eq!(body["statusCode"], 200);

        service.process_log_request(&format!(
            r#"{{"requestType":"store","connectionKey":"{key}","key":"score","value":"9"}}"#
        ));
        let (_, body) = request(port, &host, "/vrcx/data/get?key=score").await;
        assert_eq!(json(&body)["data"], "9");
        let (_, body) = request(port, &host, "/vrcx/data/get?key=missing").await;
        assert!(json(&body)["data"].is_null());
        let (status, body) = request(port, &host, "/vrcx/data/get").await;
        assert_eq!(status, 400);
        assert_eq!(json(&body)["error"], "Missing key parameter.");

        let (_, body) = request(port, &host, "/vrcx/data/getall").await;
        let all: serde_json::Value =
            serde_json::from_str(json(&body)["data"].as_str().unwrap()).unwrap();
        assert_eq!(all["score"], "9");

        let (_, body) = request(port, &host, "/vrcx/data/getbulk?keys=score,none").await;
        let bulk: serde_json::Value =
            serde_json::from_str(json(&body)["data"].as_str().unwrap()).unwrap();
        assert_eq!(bulk["score"], "9");
        assert!(bulk["none"].is_null());

        let (status, _) = request(port, &host, "/vrcx/status").await;
        assert_eq!(status, 200);
        let (status, body) = request(port, &host, "/vrcx/nothing").await;
        assert_eq!(status, 404);
        assert_eq!(json(&body)["error"], "Invalid VRCX endpoint.");
        cancel.cancel();
    }

    #[tokio::test]
    async fn other_worlds_are_read_only_when_they_allow_it() {
        let (service, port, cancel) = start("wrld_a").await;
        let host = format!("localhost:{port}");
        let other_key = service.ensure_world("wrld_b").unwrap();
        service.process_log_request(&format!(
            r#"{{"requestType":"store","connectionKey":"{other_key}","key":"k","value":"secret"}}"#
        ));

        let (_, body) = request(port, &host, "/vrcx/data/get?key=k&world=wrld_b").await;
        assert!(json(&body)["data"].is_null());

        service.set_allow_external_read("wrld_b", true).unwrap();
        let (_, body) = request(port, &host, "/vrcx/data/get?key=k&world=wrld_b").await;
        assert_eq!(json(&body)["data"], "secret");
        cancel.cancel();
    }

    #[tokio::test]
    async fn settings_and_last_error_match_vrcx() {
        let (service, port, cancel) = start("wrld_a").await;
        let host = format!("127.0.0.1:{port}");
        let (status, body) = request(
            port,
            &host,
            "/vrcx/data/settings?set=externalReads&value=yes",
        )
        .await;
        assert_eq!(status, 400);
        assert_eq!(
            json(&body)["error"],
            "Invalid value for 'externalReads' setting."
        );
        request(
            port,
            &host,
            "/vrcx/data/settings?set=externalReads&value=true",
        )
        .await;
        assert!(service.may_read("wrld_a").unwrap());

        service.process_log_request("{}");
        let (_, body) = request(port, &host, "/vrcx/data/lasterror").await;
        let body = json(&body);
        assert_eq!(body["ok"], false);
        assert_eq!(body["data"], "`requestType` is missing or null");
        let (_, body) = request(port, &host, "/vrcx/data/lasterror").await;
        assert_eq!(json(&body)["ok"], true);
        cancel.cancel();
    }

    #[tokio::test]
    async fn requests_outside_a_world_fail_like_vrcx() {
        let (_, port, cancel) = start("").await;
        let (status, body) = request(port, &format!("127.0.0.1:{port}"), "/vrcx/data/init").await;
        assert_eq!(status, 500);
        assert_eq!(
            json(&body)["error"],
            "Failed to get/verify current world ID."
        );
        cancel.cancel();
    }

    #[tokio::test]
    async fn foreign_hosts_are_refused() {
        let (_, port, cancel) = start("wrld_a").await;
        let (status, _) = request(port, &format!("evil.example:{port}"), "/vrcx/data/init").await;
        assert_eq!(status, 403);
        cancel.cancel();
    }
}
