import { describe, expect, it } from 'vitest';

import {
    answerReadDocs,
    listDocs,
    readDoc,
    searchDocs,
    splitDocSections,
    stemWord
} from './assistantDocs';

describe('assistant docs', () => {
    it('splits a doc into sections with heading paths, skipping code fences and badges', () => {
        const sections = splitDocSections(
            'x',
            [
                '[![Badge](https://example.com/b.svg)](https://example.com)',
                'Intro text.',
                '# Title',
                'Top.',
                '## Part',
                'Body.',
                '```sh',
                '# not a heading',
                '```',
                '### Detail',
                'Deep.'
            ].join('\n')
        );
        expect(sections.map((section) => section.path)).toEqual([
            [],
            ['Title'],
            ['Title', 'Part'],
            ['Title', 'Part', 'Detail']
        ]);
        expect(sections[0].text).toBe('Intro text.');
        expect(sections[2].text).toContain('# not a heading');
    });

    it('ships every doc in docs/, the README and the developer notes', () => {
        const ids = listDocs().docs.map((doc) => doc.docId);
        expect(ids.slice(0, 2)).toEqual(['user_guide', 'features']);
        expect(ids.slice(-5)).toEqual([
            'readme',
            'contributing',
            'security',
            'sounds',
            'agents'
        ]);
        for (const id of [
            'pages',
            'dialogs',
            'layout_and_appearance',
            'notifications_and_vr',
            'tools',
            'ai_assistant',
            'integrations',
            'troubleshooting',
            'badges',
            'install',
            'recorder'
        ]) {
            expect(ids).toContain(id);
        }
        expect(listDocs().docs[0].sections).toContain(
            'Using VRCX-0-Nanashi > Finding your way around'
        );
    });

    it('finds the sections that answer a question', () => {
        const result = searchDocs('wrist overlay pages');
        expect('results' in result && result.results[0]).toMatchObject({
            docId: 'features'
        });
        expect(
            'results' in result &&
                result.results.some((entry) =>
                    entry.section.includes('Wrist overlay pages')
                )
        ).toBe(true);
    });

    it('answers loose descriptions of what the user sees', () => {
        const result = searchDocs('what is the glitchy red badge?');
        expect('results' in result && result.results[0]).toMatchObject({
            docId: 'badges',
            section:
                'Badges > Built-in badges > Developer badge (the glitchy red badge)'
        });
        const staff = searchDocs('blue staff badges');
        expect('results' in staff && staff.results[0].section).toContain(
            'VRChat Staff badge'
        );
    });

    it('matches word forms', () => {
        expect(stemWord('glitchy')).toBe('glitch');
        expect(stemWord('glitches')).toBe('glitch');
        expect(stemWord('badges')).toBe('badge');
        expect(stemWord('red')).toBe('red');
    });

    it('reads one section with its subsections, or reports a bad id', () => {
        const section = readDoc('user_guide', 'Settings');
        expect('text' in section && section.text).toContain('## Settings');
        expect('text' in section && section.text).not.toContain(
            '## Notifications'
        );
        expect(readDoc('nope')).toHaveProperty('error');
        expect(readDoc('user_guide', 'No such heading')).toHaveProperty(
            'error'
        );
    });

    it('routes tool arguments to list, search or read', () => {
        expect(answerReadDocs({})).toHaveProperty('docs');
        expect(answerReadDocs({ query: 'telemetry opt out' })).toHaveProperty(
            'results'
        );
        expect(answerReadDocs({ docId: 'install' })).toHaveProperty('text');
    });
});
