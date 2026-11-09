pub(crate) fn ascii_punctuation(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        let replacement = match ch {
            '\u{2018}'..='\u{201b}' | '\u{2039}' | '\u{203a}' | '\u{02bc}' | '\u{ff07}' => "'",
            '\u{201c}'..='\u{201f}' | '\u{00ab}' | '\u{00bb}' | '\u{ff02}' => "\"",
            '\u{2010}'..='\u{2012}' | '\u{2212}' => "-",
            '\u{2013}'..='\u{2015}' => " - ",
            '\u{2026}' => "...",
            '\u{00a0}' | '\u{2007}' | '\u{2009}' | '\u{202f}' => " ",
            '\u{2022}' | '\u{2023}' | '\u{2043}' => "-",
            '\u{2190}' => "<-",
            '\u{2192}' => "->",
            '\u{2194}' => "<->",
            _ => {
                output.push(ch);
                continue;
            }
        };
        output.push_str(replacement);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_ascii_typography_without_dropping_names_or_markdown() {
        assert_eq!(
            ascii_punctuation("**It\u{2019}s** \u{201c}on\u{201d}\u{2014}wait\u{2026}\n\u{2022} Caf\u{00e9}\u{00a0}\u{2192} off"),
            "**It's** \"on\" - wait...\n- Caf\u{00e9} -> off"
        );
        assert_eq!(
            ascii_punctuation("Plain ASCII - 'quoted'."),
            "Plain ASCII - 'quoted'."
        );
    }
}
