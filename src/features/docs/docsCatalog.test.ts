import { describe, expect, it } from 'vitest';

import {
    DOC_SOURCES,
    DOCS_REPOSITORY_URL,
    headingSlug,
    resolveDocLink
} from './docsCatalog';

describe('docs catalog', () => {
    it('knows where each doc lives in the repository', () => {
        const paths = Object.fromEntries(
            DOC_SOURCES.map((source) => [source.id, source.path])
        );
        expect(paths).toMatchObject({
            user_guide: 'docs/USER_GUIDE.md',
            features: 'docs/FEATURES.md',
            recorder: 'docs/RECORDER.md',
            readme: 'README.md',
            contributing: 'CONTRIBUTING.md',
            security: 'SECURITY.md'
        });
    });

    it('makes GitHub-style heading anchors', () => {
        expect(headingSlug('Import from VRCX or VRCX-0')).toBe(
            'import-from-vrcx-or-vrcx-0'
        );
        expect(headingSlug('History sync (RemoteSync), off by default')).toBe(
            'history-sync-remotesync-off-by-default'
        );
    });

    it('keeps links between docs in the viewer and sends the rest out', () => {
        expect(resolveDocLink('docs/FEATURES.md', 'TELEMETRY.md')).toEqual({
            kind: 'doc',
            docId: 'telemetry',
            anchor: ''
        });
        expect(resolveDocLink('README.md', 'docs/INSTALL.md#linux')).toEqual({
            kind: 'doc',
            docId: 'install',
            anchor: 'linux'
        });
        expect(resolveDocLink('docs/INSTALL.md', '../README.md')).toEqual({
            kind: 'doc',
            docId: 'readme',
            anchor: ''
        });
        expect(resolveDocLink('docs/USER_GUIDE.md', '#settings')).toEqual({
            kind: 'doc',
            docId: 'user_guide',
            anchor: 'settings'
        });
        expect(resolveDocLink('README.md', 'LICENSE')).toEqual({
            kind: 'external',
            url: `${DOCS_REPOSITORY_URL}LICENSE`
        });
        expect(resolveDocLink('README.md', 'https://example.com/x')).toEqual({
            kind: 'external',
            url: 'https://example.com/x'
        });
    });
});
