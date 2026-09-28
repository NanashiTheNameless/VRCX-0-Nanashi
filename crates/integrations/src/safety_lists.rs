//! Fetch only explicitly configured list endpoints. Never used for observed game URLs.
use std::time::Duration;

const MAX_BYTES: usize = 8 * 1024 * 1024;

pub async fn fetch_safety_list(url: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("List URL must use HTTPS without credentials".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("VRCX-0-Nanashi/safety-lists")
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("List server returned HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err("List exceeds 8 MB".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("List exceeds 8 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "List is not UTF-8 text".into())
}
