use serde_json::Value;
use url::Url;

pub const NASA_EPIC_METADATA_URL: &str = "https://epic.gsfc.nasa.gov/api/natural";
pub const AIC_PUBLIC_DOMAIN_SEARCH_URL: &str = "https://api.artic.edu/api/v1/artworks/search?query[term][is_public_domain]=true&fields=id,title,artist_display,image_id,is_public_domain&limit=100";
const AIC_DEFAULT_IIIF_URL: &str = "https://www.artic.edu/iiif/2";
const NASA_APOD_API_URL: &str = "https://api.nasa.gov/planetary/apod";
const NASA_APOD_API_KEY: &str = "DEMO_KEY";
pub const NASA_APOD_IMAGE_LOOKBACK_DAYS: u32 = 30;

const NASA_APOD_ALLOWED_HOSTS: [&str; 3] =
    ["apod.nasa.gov", "www.nasa.gov", "images-assets.nasa.gov"];

#[derive(Debug, thiserror::Error)]
pub enum BackgroundImageProtocolError {
    #[error("{0}")]
    Custom(String),
}

type Result<T> = std::result::Result<T, BackgroundImageProtocolError>;

fn custom(message: impl Into<String>) -> BackgroundImageProtocolError {
    BackgroundImageProtocolError::Custom(message.into())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackgroundImageProviderImage {
    pub image_url: String,
    pub title: String,
    pub author: String,
    pub license: String,
    pub source: String,
}

pub fn nasa_apod_request_url(date: &str) -> String {
    format!("{NASA_APOD_API_URL}?api_key={NASA_APOD_API_KEY}&thumbs=false&date={date}")
}

pub fn stable_daily_index(date_key: &str, length: usize) -> usize {
    let seed: u32 = date_key.chars().map(|value| value as u32).sum();
    (seed as usize) % length.max(1)
}

fn normalize_https_url(raw_url: &str, allowed_hosts: Option<&[&str]>) -> Result<String> {
    let mut parsed =
        Url::parse(raw_url).map_err(|error| custom(format!("invalid image URL: {error}")))?;
    let hostname = parsed
        .host_str()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let host_allowed = allowed_hosts.is_none_or(|hosts| hosts.contains(&hostname.as_str()));

    if parsed.scheme() == "http" && host_allowed && allowed_hosts.is_some() {
        let _ = parsed.set_scheme("https");
    }
    if parsed.scheme() != "https" {
        return Err(custom("Background Image must use HTTPS."));
    }
    if !host_allowed {
        return Err(custom("Background Image host is not allowed."));
    }
    Ok(parsed.to_string())
}

fn parse_json(body: &str) -> Result<Value> {
    serde_json::from_str(body)
        .map_err(|error| custom(format!("invalid provider response: {error}")))
}

fn text_field<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or_default()
}

pub fn parse_nasa_epic_response(body: &str) -> Result<BackgroundImageProviderImage> {
    let payload = parse_json(body)?;
    let entry = payload
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|entry| {
            !text_field(entry, "image").is_empty() && !text_field(entry, "date").is_empty()
        })
        .max_by(|left, right| text_field(left, "date").cmp(text_field(right, "date")))
        .ok_or_else(|| custom("NASA EPIC did not return image metadata."))?;

    let date = text_field(entry, "date")
        .split(' ')
        .next()
        .unwrap_or_default();
    let mut parts = date.split('-');
    let (Some(yyyy), Some(mm), Some(dd)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(custom("NASA EPIC did not return image metadata."));
    };
    let image = text_field(entry, "image");
    let image_url = normalize_https_url(
        &format!("https://epic.gsfc.nasa.gov/archive/natural/{yyyy}/{mm}/{dd}/jpg/{image}.jpg"),
        None,
    )?;
    let caption = text_field(entry, "caption");

    Ok(BackgroundImageProviderImage {
        image_url,
        title: if caption.is_empty() {
            "Earth from DSCOVR EPIC".into()
        } else {
            caption.into()
        },
        author: "NASA EPIC / DSCOVR".into(),
        license: "NASA media usage guidelines".into(),
        source: "NASA EPIC".into(),
    })
}

pub fn parse_aic_response(body: &str, date_key: &str) -> Result<BackgroundImageProviderImage> {
    let payload = parse_json(body)?;
    let artworks: Vec<&Value> = payload
        .get("data")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|entry| {
            entry.get("is_public_domain").and_then(Value::as_bool) == Some(true)
                && !text_field(entry, "image_id").is_empty()
        })
        .collect();
    if artworks.is_empty() {
        return Err(custom("AIC did not return public-domain image metadata."));
    }

    let artwork = artworks[stable_daily_index(date_key, artworks.len())];
    let iiif_base = payload
        .get("config")
        .map(|config| text_field(config, "iiif_url"))
        .filter(|value| !value.is_empty())
        .unwrap_or(AIC_DEFAULT_IIIF_URL);
    let image_id = text_field(artwork, "image_id");
    let image_url = normalize_https_url(
        &format!("{iiif_base}/{image_id}/full/1686,/0/default.jpg"),
        None,
    )?;
    let title = text_field(artwork, "title");
    let author = text_field(artwork, "artist_display");

    Ok(BackgroundImageProviderImage {
        image_url,
        title: if title.is_empty() {
            "Public domain artwork".into()
        } else {
            title.into()
        },
        author: if author.is_empty() {
            "Art Institute of Chicago".into()
        } else {
            author.into()
        },
        license: "Public Domain".into(),
        source: "Art Institute of Chicago".into(),
    })
}

pub fn parse_nasa_apod_response(
    body: &str,
    fallback_date: &str,
) -> Result<Option<BackgroundImageProviderImage>> {
    let payload = parse_json(body)?;
    if text_field(&payload, "media_type") != "image"
        || !text_field(&payload, "copyright").trim().is_empty()
    {
        return Ok(None);
    }

    let raw_image_url = {
        let hd = text_field(&payload, "hdurl").trim();
        if hd.is_empty() {
            text_field(&payload, "url").trim()
        } else {
            hd
        }
    };
    if raw_image_url.is_empty() {
        return Ok(None);
    }
    let Ok(image_url) = normalize_https_url(raw_image_url, Some(&NASA_APOD_ALLOWED_HOSTS)) else {
        return Ok(None);
    };

    let title = text_field(&payload, "title");
    let date = text_field(&payload, "date");
    Ok(Some(BackgroundImageProviderImage {
        image_url,
        title: if title.is_empty() {
            "NASA Astronomy Picture of the Day".into()
        } else {
            title.into()
        },
        author: "NASA APOD".into(),
        license: "Public Domain / no copyright field".into(),
        source: if date.is_empty() {
            fallback_date.into()
        } else {
            date.into()
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nasa_epic_picks_latest_entry_and_builds_archive_url() {
        let body = r#"[
            {"image": "epic_old", "date": "2026-07-01 00:31:45", "caption": "Old"},
            {"image": "epic_new", "date": "2026-07-02 00:31:45", "caption": "Fresh Earth"}
        ]"#;
        let image = parse_nasa_epic_response(body).unwrap();
        assert_eq!(
            image.image_url,
            "https://epic.gsfc.nasa.gov/archive/natural/2026/07/02/jpg/epic_new.jpg"
        );
        assert_eq!(image.title, "Fresh Earth");
    }

    #[test]
    fn nasa_epic_rejects_empty_metadata() {
        assert!(parse_nasa_epic_response("[]").is_err());
        assert!(parse_nasa_epic_response(r#"[{"image": "", "date": ""}]"#).is_err());
    }

    #[test]
    fn aic_selects_stable_daily_artwork_from_public_domain_entries() {
        let body = r#"{
            "data": [
                {"title": "A", "artist_display": "Artist A", "image_id": "img-a", "is_public_domain": true},
                {"title": "B", "artist_display": "Artist B", "image_id": "img-b", "is_public_domain": false},
                {"title": "C", "artist_display": "", "image_id": "img-c", "is_public_domain": true}
            ],
            "config": {"iiif_url": "https://www.artic.edu/iiif/2"}
        }"#;
        let image = parse_aic_response(body, "2026-07-30").unwrap();
        let expected_index = stable_daily_index("2026-07-30", 2);
        let expected_id = ["img-a", "img-c"][expected_index];
        assert_eq!(
            image.image_url,
            format!("https://www.artic.edu/iiif/2/{expected_id}/full/1686,/0/default.jpg")
        );
        assert_eq!(image.license, "Public Domain");
    }

    #[test]
    fn apod_skips_video_and_copyrighted_entries() {
        let video = r#"{"media_type": "video", "url": "https://apod.nasa.gov/a.jpg"}"#;
        assert!(parse_nasa_apod_response(video, "2026-07-30")
            .unwrap()
            .is_none());
        let copyrighted = r#"{"media_type": "image", "copyright": "Someone", "url": "https://apod.nasa.gov/a.jpg"}"#;
        assert!(parse_nasa_apod_response(copyrighted, "2026-07-30")
            .unwrap()
            .is_none());
    }

    #[test]
    fn apod_prefers_hdurl_and_enforces_host_allowlist() {
        let body = r#"{
            "media_type": "image",
            "title": "Nebula",
            "date": "2026-07-29",
            "url": "https://apod.nasa.gov/low.jpg",
            "hdurl": "http://apod.nasa.gov/high.jpg"
        }"#;
        let image = parse_nasa_apod_response(body, "2026-07-30")
            .unwrap()
            .unwrap();
        assert_eq!(image.image_url, "https://apod.nasa.gov/high.jpg");
        assert_eq!(image.source, "2026-07-29");

        let disallowed = r#"{"media_type": "image", "url": "https://evil.example/a.jpg"}"#;
        assert!(parse_nasa_apod_response(disallowed, "2026-07-30")
            .unwrap()
            .is_none());
    }

    #[test]
    fn stable_daily_index_matches_char_code_sum_modulo() {
        assert_eq!(stable_daily_index("2026-07-30", 7), 4);
        assert_eq!(stable_daily_index("2026-07-31", 7), 5);
        assert_eq!(stable_daily_index("2026-07-30", 0), 0);
    }
}
