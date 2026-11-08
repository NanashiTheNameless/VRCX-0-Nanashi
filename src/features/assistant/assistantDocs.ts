import {
    DOC_SOURCES as SOURCES,
    splitDocSections,
    type DocSection
} from '@/features/docs/docsCatalog';

export { splitDocSections };

const SEARCH_LIMIT = 5;
const SEARCH_SECTION_CHARS = 1800;
const READ_CHARS = 8000;

let cached: DocSection[] | null = null;

function allSections(): DocSection[] {
    cached ??= SOURCES.flatMap((source) =>
        splitDocSections(source.id, source.text)
    );
    return cached;
}

// Words too common to tell sections apart.
const STOP_WORDS = new Set([
    'the',
    'and',
    'for',
    'are',
    'what',
    'how',
    'does',
    'that',
    'this',
    'with',
    'can',
    'why',
    'who',
    'where',
    'when',
    'its',
    'you',
    'your',
    'have',
    'has',
    'from',
    'into',
    'about',
    'there',
    'they',
    'mean',
    'means',
    'app'
]);

// A rough stem so word forms find each other: "glitchy" and "glitches" both
// become "glitch", "badges" becomes "badge".
export function stemWord(word: string): string {
    const keep = (stem: string) => (stem.length >= 4 ? stem : word);
    if (/(ch|sh|x|s|z)es$/.test(word)) {
        return keep(word.slice(0, -2));
    }
    if (word.endsWith('ies')) {
        return keep(word.slice(0, -3));
    }
    for (const suffix of ['ing', 'ed', 'ly', 'y']) {
        if (word.endsWith(suffix)) {
            return keep(word.slice(0, -suffix.length));
        }
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
        return keep(word.slice(0, -1));
    }
    return word;
}

function terms(query: string): string[] {
    return [
        ...new Set(
            query
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
                .map(stemWord)
        )
    ];
}

function clip(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}\n[...]` : text;
}

export function listDocs() {
    return {
        docs: SOURCES.map((source) => ({
            docId: source.id,
            title: source.title,
            sections: allSections()
                .filter((section) => section.docId === source.id)
                .map((section) => section.path.join(' > '))
                .filter(Boolean)
        }))
    };
}

export function searchDocs(query: string) {
    const words = terms(query);
    if (!words.length) {
        return listDocs();
    }
    const scored = allSections()
        .map((section) => {
            const heading = section.path.join(' ').toLowerCase();
            const body = section.text.toLowerCase();
            let matched = 0;
            let score = 0;
            for (const word of words) {
                const inHeading = heading.includes(word);
                const inBody = body.includes(word);
                if (inHeading || inBody) {
                    matched += 1;
                }
                score += (inHeading ? 3 : 0) + (inBody ? 1 : 0);
            }
            // Sections that match more of the question come first.
            score += matched * 10;
            if (!matched) {
                score = 0;
            }
            return { section, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT);
    return {
        results: scored.map(({ section }) => ({
            docId: section.docId,
            section: section.path.join(' > '),
            text: clip(section.text, SEARCH_SECTION_CHARS)
        })),
        ...(scored.length
            ? {}
            : { note: 'Nothing matched. Try other words, or list the docs.' })
    };
}

/** A whole doc, or one section of it with its subsections. */
export function readDoc(docId: string, section?: string) {
    const source = SOURCES.find((entry) => entry.id === docId);
    if (!source) {
        return {
            error: `Unknown docId. Use one of: ${SOURCES.map((entry) => entry.id).join(', ')}.`
        };
    }
    const sections = allSections().filter((entry) => entry.docId === docId);
    const wanted = section?.trim().toLowerCase();
    const start = wanted
        ? sections.findIndex(
              (entry) =>
                  entry.heading.toLowerCase() === wanted ||
                  entry.path.join(' > ').toLowerCase() === wanted
          )
        : 0;
    if (start < 0) {
        return {
            error: 'Unknown section. List the docs to see their sections.'
        };
    }
    const depth = wanted ? sections[start].path.length : 0;
    const picked = [sections[start]];
    for (const entry of sections.slice(start + 1)) {
        if (wanted && entry.path.length <= depth) {
            break;
        }
        picked.push(entry);
    }
    const text = picked
        .map((entry) =>
            entry.heading
                ? `${'#'.repeat(entry.path.length)} ${entry.heading}\n${entry.text}`
                : entry.text
        )
        .join('\n\n');
    return { docId, title: source.title, text: clip(text, READ_CHARS) };
}

export function answerReadDocs(args: unknown) {
    const record =
        args && typeof args === 'object'
            ? (args as Record<string, unknown>)
            : {};
    const docId = typeof record.docId === 'string' ? record.docId : '';
    const section = typeof record.section === 'string' ? record.section : '';
    const query = typeof record.query === 'string' ? record.query : '';
    if (docId) {
        return readDoc(docId, section || undefined);
    }
    return query.trim() ? searchDocs(query) : listDocs();
}
