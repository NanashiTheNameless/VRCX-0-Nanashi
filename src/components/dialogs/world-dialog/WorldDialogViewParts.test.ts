import { describe, expect, it } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';

import { resolveInstanceRows } from './WorldDialogViewParts';

function world(fields: Partial<WorldProfileRecord>) {
    return { id: 'wrld_test', ...fields } as WorldProfileRecord;
}

describe('resolveInstanceRows', () => {
    it('reads slim instances before the legacy instance tuples', () => {
        const rows = resolveInstanceRows(
            world({
                slimInstances: [
                    {
                        instanceId: '123~group(grp_team)',
                        n_users: 7,
                        languageRatio: { en: 1 }
                    }
                ],
                instances: [['999', 1]]
            })
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: '123~group(grp_team)',
            occupants: 7,
            location: 'wrld_test:123~group(grp_team)'
        });
    });

    it('falls back to the legacy instance tuples when slim instances are empty', () => {
        const rows = resolveInstanceRows(
            world({ slimInstances: [], instances: [['456', 3]] })
        );

        expect(rows.map((row) => [row.location, row.occupants])).toEqual([
            ['wrld_test:456', 3]
        ]);
    });
});
