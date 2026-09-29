// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { findSettingsMatches } from './SettingsSearch';

function buildSettingsDom() {
    const root = document.createElement('div');
    root.innerHTML = `
        <div data-settings-tab="system">
            <section data-settings-card-id="system.app">
                <span data-settings-card-title>Application</span>
                <div data-settings-search-item>
                    <label data-slot="field-label">Start at System Startup</label>
                    <p data-slot="field-description">Launches the app on login.</p>
                </div>
                <div data-settings-search-item>
                    <label data-slot="field-label">Updates</label>
                    <p data-slot="field-description">Check and install in the background.</p>
                </div>
            </section>
        </div>
        <div data-settings-tab="interface">
            <section data-settings-card-id="interface.theme">
                <span data-settings-card-title>Theme</span>
                <div data-settings-search-item>
                    <label data-slot="field-label">Reduce Effects</label>
                    <p data-slot="field-description">Turn off animations and blur for better performance.</p>
                </div>
            </section>
        </div>`;
    return root;
}

describe('findSettingsMatches', () => {
    it('returns nothing for a blank query', () => {
        expect(findSettingsMatches(buildSettingsDom(), '   ')).toEqual([]);
    });

    it('matches labels case-insensitively with the owning tab and card', () => {
        const [match] = findSettingsMatches(buildSettingsDom(), 'startup');

        expect(match).toMatchObject({
            tab: 'system',
            cardId: 'system.app',
            cardTitle: 'Application',
            label: 'Start at System Startup'
        });
    });

    it('requires every word and searches descriptions', () => {
        const root = buildSettingsDom();

        expect(
            findSettingsMatches(root, 'blur performance').map(
                (match) => match.label
            )
        ).toEqual(['Reduce Effects']);
        expect(findSettingsMatches(root, 'blur startup')).toEqual([]);
    });

    it('lists label hits before card and description hits', () => {
        const labels = findSettingsMatches(buildSettingsDom(), 'theme').map(
            (match) => match.label
        );

        expect(labels).toEqual(['Theme', 'Reduce Effects']);
    });
});
