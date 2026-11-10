use std::{cell::RefCell, collections::HashMap, fmt::Write, sync::OnceLock};

use serde::Deserialize;
use slint::{Image, Rgba8Pixel, SharedPixelBuffer};

use super::OverlayBadgeItem;

const SCALE: u32 = 2;
const CANVAS: u32 = 44;

#[derive(Deserialize)]
struct Stop {
    at: f64,
    value: f64,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum Easing {
    Curve([f64; 4]),
    Steps(String),
}

#[derive(Deserialize)]
struct Timing {
    duration: f64,
    delay: f64,
    easing: Easing,
}

#[derive(Deserialize)]
struct Animation {
    #[serde(flatten)]
    timing: Timing,
    tracks: HashMap<String, Vec<Stop>>,
}

#[derive(Deserialize)]
struct Sparkle {
    x: f64,
    y: f64,
    size: f64,
    duration: f64,
    delay: f64,
}

#[derive(Deserialize)]
struct Dot {
    x: f64,
    y: f64,
    color: [f64; 3],
    radius: f64,
    outer: f64,
}

#[derive(Deserialize)]
struct Ember {
    animation: String,
    #[serde(flatten)]
    timing: Timing,
    dots: Vec<Dot>,
}

#[derive(Deserialize)]
struct Glint {
    x: f64,
    y: f64,
    size: f64,
    #[serde(flatten)]
    timing: Timing,
}

#[derive(Deserialize)]
struct Effects {
    animations: HashMap<String, Animation>,
    sparkles: Vec<Sparkle>,
    embers: Vec<Ember>,
    glints: Vec<Glint>,
    #[serde(rename = "shimmerAngle")]
    shimmer_angle: f64,
}

fn effects() -> &'static Effects {
    static EFFECTS: OnceLock<Effects> = OnceLock::new();
    EFFECTS.get_or_init(|| {
        serde_json::from_str(include_str!("../../ui/badge-effects.json"))
            .expect("valid generated badge effects")
    })
}

fn ease(easing: &Easing, progress: f64) -> f64 {
    let Easing::Curve([x1, y1, x2, y2]) = easing else {
        if let Easing::Steps(name) = easing {
            debug_assert_eq!(name, "steps");
        }
        return 0.0;
    };
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    let bezier = |t: f64, a: f64, b: f64| {
        3.0 * (1.0 - t).powi(2) * t * a + 3.0 * (1.0 - t) * t * t * b + t.powi(3)
    };
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..24 {
        let t = (low + high) / 2.0;
        if bezier(t, *x1, *x2) < progress {
            low = t;
        } else {
            high = t;
        }
    }
    bezier((low + high) / 2.0, *y1, *y2)
}

impl Animation {
    fn sample(&self, property: &str, ms: f64, timing: Option<&Timing>) -> f64 {
        let fallback = match property {
            "opacity" | "sx" | "sy" => 1.0,
            _ => 0.0,
        };
        let Some(stops) = self.tracks.get(property) else {
            return fallback;
        };
        let timing = timing.unwrap_or(&self.timing);
        if ms < timing.delay {
            return stops[0].value;
        }
        let p = (ms - timing.delay).rem_euclid(timing.duration) / timing.duration;
        for pair in stops.windows(2) {
            let [a, b] = pair else { unreachable!() };
            if p >= a.at && p < b.at {
                let progress = (p - a.at) / (b.at - a.at);
                return a.value + (b.value - a.value) * ease(&timing.easing, progress);
            }
        }
        stops.last().map_or(fallback, |stop| stop.value)
    }

    fn transform(
        &self,
        ms: f64,
        timing: Option<&Timing>,
        origin: (f64, f64),
        size: (f64, f64),
    ) -> String {
        let at = |property| self.sample(property, ms, timing);
        let x = at("x") + size.0 * at("xp") / 100.0;
        let y = at("y") + size.1 * at("yp") / 100.0;
        let sx = at("sx") * at("rotateY").to_radians().cos();
        format!(
            "translate({x} {y}) translate({} {}) rotate({}) scale({sx} {}) translate({} {})",
            origin.0,
            origin.1,
            at("rotate"),
            at("sy"),
            -origin.0,
            -origin.1
        )
    }
}

type CacheKey = (String, [u32; 5], u16, bool);

thread_local! {
    static FRAMES: RefCell<HashMap<CacheKey, (i64, Image)>> = RefCell::new(HashMap::new());
}

pub(super) fn frame(badge: OverlayBadgeItem, time: f32) -> Image {
    let flags = [
        badge.shimmer,
        badge.flow,
        badge.sparkle,
        badge.glow,
        badge.embers,
        badge.wiggle,
        badge.flip,
        badge.glitch,
        badge.upstream_glint,
        badge.flip_before_wiggle,
    ]
    .iter()
    .enumerate()
    .fold(0, |bits, (i, on)| bits | (u16::from(*on) << i));
    let key = (
        badge.icon.to_string(),
        [
            badge.from.as_argb_encoded(),
            badge.to.as_argb_encoded(),
            badge.border.as_argb_encoded(),
            badge.icon_color.as_argb_encoded(),
            badge.glow_color.as_argb_encoded(),
        ],
        flags,
        badge.round,
    );
    let tick = if time < 0.0 {
        -1
    } else {
        (f64::from(time) / 16.0).floor() as i64
    };
    if let Some(image) = FRAMES.with(|cache| {
        cache
            .borrow()
            .get(&key)
            .filter(|(at, _)| *at == tick)
            .map(|(_, image)| image.clone())
    }) {
        return image;
    }
    let image =
        raster(&badge, if tick < 0 { -1.0 } else { tick as f64 * 16.0 }).unwrap_or_default();
    FRAMES.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.len() >= 512 {
            cache.clear();
        }
        cache.insert(key, (tick, image.clone()));
    });
    image
}

fn color(color: slint::Color) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        color.red(),
        color.green(),
        color.blue()
    )
}

fn mixed(badge: &OverlayBadgeItem, weights: [f64; 3]) -> String {
    let channel = |a: u8, b: u8| {
        (f64::from(a) * weights[0] + f64::from(b) * weights[1] + 255.0 * weights[2]).round() as u8
    };
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(badge.from.red(), badge.to.red()),
        channel(badge.from.green(), badge.to.green()),
        channel(badge.from.blue(), badge.to.blue())
    )
}

fn glyph(badge: &OverlayBadgeItem, tint: &str) -> String {
    let path = badge
        .icon
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;");
    let stroke = if badge.glitch {
        2.75
    } else if badge.upstream_glint {
        2.25
    } else {
        2.5
    };
    let size = if badge.upstream_glint {
        11.0
    } else if badge.glitch {
        12.0
    } else {
        11.0
    };
    let inset = (20.0 - size) / 2.0;
    let fill = if badge.upstream_glint {
        "rgba(120,170,230,0.35)"
    } else {
        "none"
    };
    format!(
        r#"<g transform="translate({inset} {inset}) scale({})"><path d="{path}" fill="{fill}" stroke="{tint}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/></g>"#,
        size / 24.0
    )
}

fn raster(badge: &OverlayBadgeItem, ms: f64) -> Option<Image> {
    let svg = svg(badge, ms);
    let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).ok()?;
    let mut pixels = resvg::tiny_skia::Pixmap::new(CANVAS * SCALE, CANVAS * SCALE)?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(SCALE as f32, SCALE as f32),
        &mut pixels.as_mut(),
    );
    let buffer = SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
        pixels.data(),
        CANVAS * SCALE,
        CANVAS * SCALE,
    );
    Some(Image::from_rgba8_premultiplied(buffer))
}

fn svg(badge: &OverlayBadgeItem, ms: f64) -> String {
    let data = effects();
    let still = ms < 0.0;
    let sample =
        |name: &str, property: &str| data.animations[name].sample(property, ms.max(0.0), None);
    let from = color(badge.from);
    let to = color(badge.to);
    let border = color(badge.border);
    let icon = color(badge.icon_color);
    let radius = if badge.round { 10 } else { 8 };
    let mut defs = format!(
        r#"<clipPath id="clip"><rect width="20" height="20" rx="{radius}"/></clipPath><filter id="blur" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3"/></filter><linearGradient id="body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="20" y2="20">"#
    );
    if badge.glitch {
        defs.push_str(r##"<stop stop-color="#0b0b0c"/><stop offset=".55" stop-color="#1c1c1f"/><stop offset="1" stop-color="#3a0a0e"/>"##);
    } else if badge.upstream_glint {
        defs.push_str(r##"<stop stop-color="#f4f6f9"/><stop offset=".45" stop-color="#c3cad4"/><stop offset=".55" stop-color="#9aa3af"/><stop offset="1" stop-color="#dfe4ea"/>"##);
    } else {
        write!(
            defs,
            r#"<stop stop-color="{from}"/><stop offset="1" stop-color="{to}"/>"#
        )
        .unwrap();
    }
    defs.push_str("</linearGradient>");
    defs.push_str(r#"<filter id="halo" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="6"/></filter>"#);
    let mut layers = format!(r#"<rect width="20" height="20" rx="{radius}" fill="url(#body)"/>"#);
    let mut outside = String::new();
    let mut foreground = String::new();
    if badge.glitch {
        outside.push_str(r##"<rect x="2" y="2" width="16" height="16" rx="6" fill="#e5202e" opacity=".85" filter="url(#halo)"/>"##);
        layers.push_str(r#"<rect x="1.5" y="1.5" width="17" height="17" rx="6.5" fill="none" stroke="white" stroke-width="1" opacity=".12"/>"#);
    }

    if badge.glow {
        let opacity = if still {
            0.55
        } else {
            sample("award-glow", "opacity")
        };
        write!(outside, r#"<rect x="-2" y="-2" width="24" height="24" rx="{}" fill="{}" opacity="{}" filter="url(#halo)"/>"#, radius + 2, color(badge.glow_color), opacity * f64::from(badge.glow_color.alpha()) / 255.0).unwrap();
    }
    if badge.flow {
        defs.push_str(&format!(r#"<linearGradient id="flow"><stop stop-color="{from}"/><stop offset=".333333" stop-color="{to}"/><stop offset=".666667" stop-color="{from}"/><stop offset="1" stop-color="{to}"/></linearGradient>"#));
        let transform = if still {
            String::new()
        } else {
            data.animations["award-flow"].transform(ms, None, (30.0, 10.0), (60.0, 20.0))
        };
        write!(
            layers,
            r#"<rect width="60" height="20" fill="url(#flow)" transform="{transform}"/>"#
        )
        .unwrap();
    }
    if badge.shimmer && !still {
        let (dx, dy) = (
            data.shimmer_angle.to_radians().sin(),
            -data.shimmer_angle.to_radians().cos(),
        );
        let span = dx.abs() + dy.abs();
        write!(defs, r##"<linearGradient id="shimmer" x1="{}" y1="{}" x2="{}" y2="{}"><stop offset=".3" stop-color="white" stop-opacity="0"/><stop offset=".5" stop-color="white" stop-opacity=".5"/><stop offset=".7" stop-color="white" stop-opacity="0"/></linearGradient>"##, (1.0-dx*span)/2.0, (1.0-dy*span)/2.0, (1.0+dx*span)/2.0, (1.0+dy*span)/2.0).unwrap();
        let transform =
            data.animations["award-sweep"].transform(ms, None, (10.0, 10.0), (20.0, 20.0));
        write!(
            layers,
            r#"<rect width="20" height="20" fill="url(#shimmer)" transform="{transform}"/>"#
        )
        .unwrap();
    }
    if badge.sparkle {
        for (i, star) in data.sparkles.iter().enumerate() {
            let timing = Timing {
                duration: star.duration,
                delay: star.delay,
                easing: data.animations["award-sparkle"].timing.easing.clone(),
            };
            let opacity = if still {
                if matches!(i, 1..=3) {
                    0.95
                } else {
                    0.0
                }
            } else {
                data.animations["award-sparkle"].sample("opacity", ms, Some(&timing))
            };
            let transform = if still {
                String::new()
            } else {
                data.animations["award-sparkle"].transform(
                    ms,
                    Some(&timing),
                    (0.0, 0.0),
                    (star.size, star.size),
                )
            };
            write!(layers, r#"<g transform="translate({} {})" opacity="{opacity}"><g transform="{transform}"><path transform="scale({})" fill="{}" d="M0 -0.5L.11 -.11L.5 0L.11 .11L0 .5L-.11 .11L-.5 0L-.11 -.11Z"/></g></g>"#, star.x, star.y, star.size, mixed(badge, [0.2, 0.0, 0.8])).unwrap();
        }
    }
    if badge.embers {
        write!(layers, r#"<rect x="-2" y="17" width="24" height="6" fill="{from}" opacity=".8" filter="url(#blur)"/>"#).unwrap();
        for (i, ember) in data.embers.iter().enumerate() {
            let animation = &data.animations[&ember.animation];
            let opacity = if still {
                if matches!(i, 0 | 3 | 4) {
                    0.9
                } else {
                    0.0
                }
            } else {
                animation.sample("opacity", ms, Some(&ember.timing))
            };
            let transform = if still {
                "translate(1 -5)".to_string()
            } else {
                animation.transform(ms, Some(&ember.timing), (10.0, 10.0), (20.0, 20.0))
            };
            write!(layers, r#"<g opacity="{opacity}" transform="{transform}">"#).unwrap();
            for (j, dot) in ember.dots.iter().enumerate() {
                let id = format!("spark{i}-{j}");
                let tint = mixed(badge, dot.color);
                write!(defs, r#"<radialGradient id="{id}"><stop offset="{}" stop-color="{tint}"/><stop offset="1" stop-color="{tint}" stop-opacity="0"/></radialGradient>"#, dot.radius / dot.outer).unwrap();
                write!(
                    layers,
                    r#"<circle cx="{}" cy="{}" r="{}" fill="url(#{id})"/>"#,
                    dot.x, dot.y, dot.outer
                )
                .unwrap();
            }
            layers.push_str("</g>");
        }
    }

    if badge.glitch && !still {
        defs.push_str(r##"<linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset=".4" stop-color="#e5202e" stop-opacity="0"/><stop offset=".47" stop-color="#e5202e" stop-opacity=".55"/><stop offset=".5" stop-color="white" stop-opacity=".75"/><stop offset=".53" stop-color="#e5202e" stop-opacity=".55"/><stop offset=".6" stop-color="#e5202e" stop-opacity="0"/></linearGradient>"##);
        write!(
            layers,
            r#"<rect width="20" height="20" fill="url(#scan)" transform="{}"/>"#,
            data.animations["fork-dev-scan"].transform(ms, None, (10.0, 10.0), (20.0, 20.0))
        )
        .unwrap();
    }
    let mut main_glyph = glyph(badge, &icon);
    let mut transforms = Vec::new();
    if badge.wiggle && !still {
        transforms.push(("award-wiggle", (10.0, 12.2)));
    }
    if badge.flip && !still {
        let value = ("award-flip", (10.0, 10.0));
        if badge.flip_before_wiggle {
            transforms.insert(0, value);
        } else {
            transforms.push(value);
        }
    }
    for (name, origin) in transforms.into_iter().rev() {
        main_glyph = format!(
            r#"<g transform="{}">{main_glyph}</g>"#,
            data.animations[name].transform(ms, None, origin, (11.0, 11.0))
        );
    }
    if badge.embers && !still {
        main_glyph = format!(
            r#"<g opacity="{}">{main_glyph}</g>"#,
            sample("award-flicker", "opacity")
        );
    }
    if badge.glitch {
        let rim = if still {
            0.3
        } else {
            sample("fork-dev-rim", "opacity")
        };
        write!(layers, r##"<rect x="-.5" y="-.5" width="21" height="21" rx="8" fill="none" stroke="#e5202e" stroke-width="2" filter="url(#blur)" opacity="{rim}"/>"##).unwrap();
        if !still {
            for (name, tint) in [
                ("fork-dev-split-red", "#ff2a3a"),
                ("fork-dev-split-white", "#ffffff"),
            ] {
                write!(
                    layers,
                    r#"<g opacity="{}" transform="{}">{}</g>"#,
                    sample(name, "opacity"),
                    data.animations[name].transform(ms, None, (10.0, 10.0), (20.0, 20.0)),
                    glyph(badge, tint)
                )
                .unwrap();
            }
            main_glyph = format!(
                r#"<g transform="{}">{main_glyph}</g>"#,
                data.animations["fork-dev-jitter"].transform(ms, None, (10.0, 10.0), (20.0, 20.0))
            );
        }
    }
    if badge.upstream_glint && !still {
        let bloom = sample("upstream-dev-bloom", "opacity");
        main_glyph = format!(
            r#"<g opacity="{bloom}" transform="{}">{main_glyph}</g>"#,
            data.animations["upstream-dev-bloom"].transform(ms, None, (10.0, 10.0), (11.0, 11.0))
        );
    }
    layers.push_str(&main_glyph);

    if badge.glitch && !still {
        let transform =
            data.animations["fork-dev-glitch"].transform(ms, None, (10.0, 10.0), (36.0, 20.0));
        write!(
            layers,
            r#"<g opacity="{}" transform="{transform}">"#,
            sample("fork-dev-glitch", "opacity")
        )
        .unwrap();
        for (y, h, tint, opacity) in [
            (4.0, 2.4, "#e5202e", 0.8),
            (11.6, 1.2, "#ffffff", 0.6),
            (15.6, 0.8, "#e5202e", 0.5),
        ] {
            write!(layers, r#"<rect x="-8" y="{y}" width="36" height="{h}" fill="{tint}" opacity="{opacity}"/>"#).unwrap();
        }
        layers.push_str("</g>");
    }
    if badge.upstream_glint && !still {
        defs.push_str(r##"<radialGradient id="glint"><stop offset=".12" stop-color="white"/><stop offset=".24" stop-color="#bedcff" stop-opacity=".85"/><stop offset=".42" stop-color="#78aae6" stop-opacity=".35"/><stop offset=".62" stop-color="#78aae6" stop-opacity="0"/></radialGradient>"##);
        for glint in &data.glints {
            let animation = &data.animations["upstream-dev-glint"];
            let opacity = animation.sample("opacity", ms, Some(&glint.timing));
            let center = glint.size / 2.0;
            write!(foreground, r#"<g transform="translate({} {})"><g opacity="{opacity}" transform="{}"><rect width="{}" height="{}" fill="url(#glint)"/><path d="M{center} 0V{}M0 {center}H{}" stroke="white" stroke-width="{}"/></g></g>"#, glint.x, glint.y, animation.transform(ms, Some(&glint.timing), (center, center), (glint.size, glint.size)), glint.size, glint.size, glint.size, glint.size, glint.size * 0.04).unwrap();
        }
    }
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="-12 -12 44 44"><defs>{defs}</defs>{outside}<g clip-path="url(#clip)">{layers}</g><rect x=".5" y=".5" width="19" height="19" rx="{}" fill="none" stroke="{border}" stroke-width="1"/>{foreground}</svg>"#,
        f64::from(radius) - 0.5
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixels(badge: &OverlayBadgeItem, ms: f64) -> resvg::tiny_skia::Pixmap {
        let tree =
            resvg::usvg::Tree::from_str(&svg(badge, ms), &resvg::usvg::Options::default()).unwrap();
        let mut pixels = resvg::tiny_skia::Pixmap::new(CANVAS * SCALE, CANVAS * SCALE).unwrap();
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::from_scale(SCALE as f32, SCALE as f32),
            &mut pixels.as_mut(),
        );
        pixels
    }

    #[test]
    fn developer_raster_has_the_apps_red_glyph_scan_and_separate_glitch_frames() {
        let badge = OverlayBadgeItem {
            icon: "M 8 5 L 2 12 L 8 19 M 16 5 L 22 12 L 16 19 M 14 3 L 10 21".into(),
            from: slint::Color::from_rgb_u8(11, 11, 12),
            to: slint::Color::from_rgb_u8(58, 10, 14),
            border: slint::Color::from_rgb_u8(229, 32, 46),
            icon_color: slint::Color::from_rgb_u8(229, 32, 46),
            glitch: true,
            animations: true,
            ..Default::default()
        };
        let resting = pixels(&badge, 0.0);
        let glitch = pixels(&badge, 800.0);
        let scan = pixels(&badge, 5170.0);
        assert_ne!(resting.data(), glitch.data());
        assert_ne!(resting.data(), scan.data());
        let white_pixels = |image: &resvg::tiny_skia::Pixmap| {
            image
                .pixels()
                .iter()
                .filter(|px| {
                    px.red() > 100
                        && u16::from(px.green()) * 3 > u16::from(px.red())
                        && u16::from(px.blue()) * 3 > u16::from(px.red())
                })
                .count()
        };
        if let Ok(directory) = std::env::var("VRCX_BADGE_SNAPSHOTS") {
            std::fs::create_dir_all(&directory).unwrap();
            for ms in [0, 800, 870, 2000, 4520, 4845, 5170, 5495, 6000, 15500] {
                pixels(&badge, f64::from(ms))
                    .save_png(std::path::Path::new(&directory).join(format!("developer-{ms}.png")))
                    .unwrap();
            }
        }
        assert!(white_pixels(&scan) > white_pixels(&resting));
    }

    #[test]
    fn developer_scans_and_glitches_follow_the_apps_full_timeline() {
        let scan = &effects().animations["fork-dev-scan"];
        let glitch = &effects().animations["fork-dev-glitch"];
        assert_eq!(scan.timing.duration, 22_600.0);
        for start in [0.2, 0.68] {
            assert_eq!(scan.sample("yp", start * 22_600.0, None), -100.0);
            assert!(scan.sample("yp", start * 22_600.0 + 650.0, None).abs() < 0.1);
            assert_eq!(glitch.sample("opacity", start * 22_600.0, None), 0.0);
        }
        assert_eq!(glitch.sample("x", 0.035 * 22_600.0, None), -3.0);
        assert_eq!(glitch.sample("x", 0.038 * 22_600.0, None), 4.0);
        assert_eq!(glitch.sample("opacity", 0.05 * 22_600.0, None), 0.0);
    }

    #[test]
    fn icon_motion_uses_rotation_and_the_same_rest_windows_as_css() {
        let flip = &effects().animations["award-flip"];
        assert_eq!(flip.sample("rotateY", 2000.0, None), 0.0);
        assert!((flip.sample("rotateY", 2800.0, None) - 180.0).abs() < 0.001);
        let wiggle = &effects().animations["award-wiggle"];
        assert_eq!(wiggle.sample("rotate", 280.0, None), -14.0);
        assert_eq!(wiggle.sample("rotate", 2240.0, None), 0.0);
        assert_eq!(effects().sparkles.len(), 6);
        assert_eq!(
            effects()
                .embers
                .iter()
                .map(|ember| ember.dots.len())
                .sum::<usize>(),
            12
        );
    }
}
