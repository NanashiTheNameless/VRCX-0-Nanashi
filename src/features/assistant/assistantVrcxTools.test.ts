import { describe, expect, it } from 'vitest';

import {
    validateVrcxAction,
    VRCX_ASSISTANT_ACTION_TOOLS,
    VRCX_ASSISTANT_READ_TOOLS
} from './assistantVrcxTools';

describe('assistant VRCX tools', () => {
    it('keeps reads and approved actions apart', () => {
        for (const tool of VRCX_ASSISTANT_READ_TOOLS) {
            expect(VRCX_ASSISTANT_ACTION_TOOLS.has(tool)).toBe(false);
        }
        expect([...VRCX_ASSISTANT_ACTION_TOOLS]).toEqual([
            'import_vrcx_world_data',
            'merge_profile_database',
            'forget_vrcx_world_data'
        ]);
    });

    it('checks a merge request before showing its card', () => {
        expect(
            validateVrcxAction('merge_profile_database', { source: 'vrcx' })
        ).toBeNull();
        expect(
            validateVrcxAction('merge_profile_database', { source: 'file' })
        ).toMatch(/path/);
        expect(
            validateVrcxAction('merge_profile_database', {
                source: 'file',
                path: '/backups/VRCX.sqlite3'
            })
        ).toBeNull();
        expect(
            validateVrcxAction('merge_profile_database', { source: 'other' })
        ).toMatch(/source/);
        expect(validateVrcxAction('import_vrcx_world_data', {})).toBeNull();
        expect(validateVrcxAction('forget_vrcx_world_data', {})).toMatch(
            /worldId/
        );
        expect(
            validateVrcxAction('forget_vrcx_world_data', { worldId: 'wrld_a' })
        ).toBeNull();
    });
});
