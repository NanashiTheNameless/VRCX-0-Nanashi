import { describe, expect, it } from 'vitest';

import { userReportCategories } from './userReportOptions';

describe('userReportCategories', () => {
    it('builds user report categories in config order with labelled reasons', () => {
        const categories = userReportCategories({
            reportCategories: {
                behavior: { order: 1, text: 'Behavior', tooltip: 'Words' },
                chat: { order: 2, text: 'Text Chat' },
                profile: { order: 3, text: 'User Profile' }
            },
            reportOptions: {
                user: {
                    chat: ['harassing'],
                    behavior: ['hacking', 'unknown'],
                    profile: []
                },
                world: { worldpage: ['warnings'] }
            },
            reportReasons: {
                hacking: { text: 'Client Modding / Hacking', tooltip: 'Mods' },
                harassing: { text: 'Harassment' }
            }
        });

        expect(categories).toEqual([
            {
                value: 'behavior',
                label: 'Behavior',
                tooltip: 'Words',
                reasons: [
                    {
                        value: 'hacking',
                        label: 'Client Modding / Hacking',
                        tooltip: 'Mods'
                    },
                    { value: 'unknown', label: 'unknown', tooltip: '' }
                ]
            },
            {
                value: 'chat',
                label: 'Text Chat',
                tooltip: '',
                reasons: [
                    { value: 'harassing', label: 'Harassment', tooltip: '' }
                ]
            }
        ]);
    });

    it('returns no categories before the config is loaded', () => {
        expect(userReportCategories(null)).toEqual([]);
    });
});
