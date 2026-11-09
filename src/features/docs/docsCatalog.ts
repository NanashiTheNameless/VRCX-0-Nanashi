import agentsMd from '../../../AGENTS.md?raw';
import contributingMd from '../../../CONTRIBUTING.md?raw';
import soundsMd from '../../../crates/host-desktop/sounds/README.md?raw';
import readmeMd from '../../../README.md?raw';
import securityMd from '../../../SECURITY.md?raw';

// Every doc ships inside the app, so reading them never makes a request. A doc
// added to docs/ is picked up on the next build; the ones GitHub expects in the
// repository root are imported by name.
const DOCS_FOLDER = import.meta.glob<string>('../../../docs/**/*.md', {
    query: '?raw',
    import: 'default',
    eager: true
});

export const DOCS_REPOSITORY_URL =
    'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/blob/master/';

export type DocSource = {
    id: string;
    title: string;
    /** Path in the repository, for resolving links between docs. */
    path: string;
    text: string;
};

const FIRST = ['user_guide', 'features'];
const LAST = ['readme', 'contributing', 'security', 'sounds', 'agents'];

function docTitle(text: string, fallback: string): string {
    const heading = /^#\s+(.+)$/m.exec(text)?.[1];
    return heading ? cleanHeading(heading) || fallback : fallback;
}

// Inline image badges belong on GitHub, not in the document picker or search paths.
function cleanHeading(heading: string): string {
    return heading
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .trim();
}

function rank(id: string): number {
    if (FIRST.includes(id)) {
        return FIRST.indexOf(id) - FIRST.length;
    }
    if (LAST.includes(id)) {
        return 1000 + LAST.indexOf(id);
    }
    return 0;
}

export const DOC_SOURCES: readonly DocSource[] = [
    ...Object.entries(DOCS_FOLDER).map(([globPath, text]) => {
        const path = globPath.replace(/^(\.\.\/)+/, '');
        const id = path
            .replace(/^docs\//, '')
            .replace(/\.md$/i, '')
            .replace(/\//g, '_')
            .toLowerCase();
        return { id, title: docTitle(text, id), path, text };
    }),
    {
        id: 'readme',
        title: docTitle(readmeMd, 'README'),
        path: 'README.md',
        text: readmeMd
    },
    {
        id: 'contributing',
        title: docTitle(contributingMd, 'Contributing'),
        path: 'CONTRIBUTING.md',
        text: contributingMd
    },
    {
        id: 'security',
        title: docTitle(securityMd, 'Security'),
        path: 'SECURITY.md',
        text: securityMd
    },
    {
        id: 'sounds',
        title: 'Built-in notification sounds and their sources',
        path: 'crates/host-desktop/sounds/README.md',
        text: soundsMd
    },
    {
        id: 'agents',
        title: 'Notes for developers and coding agents working on the fork',
        path: 'AGENTS.md',
        text: agentsMd
    }
].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));

export function getDocSource(id: string): DocSource | undefined {
    return DOC_SOURCES.find((source) => source.id === id);
}

export type DocSection = {
    docId: string;
    heading: string;
    path: string[];
    text: string;
};

function cleanLine(line: string): string | null {
    const trimmed = line.trim();
    // Badges, images and HTML wrappers carry nothing the assistant can use.
    if (/^(\[!\[|!\[|<\/?div|<img|<br)/i.test(trimmed)) {
        return null;
    }
    return line;
}

export function splitDocSections(docId: string, text: string): DocSection[] {
    const sections: DocSection[] = [];
    const path: string[] = [];
    let current: DocSection | null = null;
    let inCode = false;
    for (const raw of text.split('\n')) {
        if (raw.trim().startsWith('```')) {
            inCode = !inCode;
        }
        const heading = inCode ? null : /^(#{1,6})\s+(.*)$/.exec(raw);
        if (heading) {
            const level = heading[1].length;
            const title = cleanHeading(heading[2]);
            path.length = level - 1;
            path[level - 1] = title;
            current = {
                docId,
                heading: title,
                path: path.filter(Boolean),
                text: ''
            };
            sections.push(current);
            continue;
        }
        const line = cleanLine(raw);
        if (line === null) {
            continue;
        }
        if (!current) {
            current = { docId, heading: '', path: [], text: '' };
            sections.push(current);
        }
        current.text += `${line}\n`;
    }
    return sections
        .map((section) => ({ ...section, text: section.text.trim() }))
        .filter((section) => section.text || section.heading);
}

/** GitHub-style heading anchor, so links like FEATURES.md#safety work. */
export function headingSlug(heading: string): string {
    return heading
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-');
}

export type ResolvedDocLink =
    | { kind: 'doc'; docId: string; anchor: string }
    | { kind: 'external'; url: string };

/**
 * Where a link in a doc goes: another doc (or a heading in this one) stays in
 * the viewer, other files in the repository open on GitHub, and web links
 * open in the browser.
 */
export function resolveDocLink(
    fromPath: string,
    href: string
): ResolvedDocLink {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return { kind: 'external', url: href };
    }
    const [target, anchor = ''] = href.split('#');
    const fromId = DOC_SOURCES.find((source) => source.path === fromPath)?.id;
    if (!target) {
        return { kind: 'doc', docId: fromId ?? '', anchor };
    }
    const resolved = new URL(
        target,
        `https://repo.invalid/${fromPath}`
    ).pathname.replace(/^\//, '');
    const doc = DOC_SOURCES.find((source) => source.path === resolved);
    return doc
        ? { kind: 'doc', docId: doc.id, anchor }
        : {
              kind: 'external',
              url: `${DOCS_REPOSITORY_URL}${resolved}${anchor ? `#${anchor}` : ''}`
          };
}
