import { describe, expect, it } from 'vitest';

import { toolDefinitions } from '@/shared/constants/tools';

import { TELEMETRY_TOOL_KEYS } from './telemetryContract';

describe('telemetry contract', () => {
    it('contains every current tool key', () => {
        expect([...TELEMETRY_TOOL_KEYS].sort()).toEqual(
            toolDefinitions.map((tool) => tool.key).sort()
        );
    });
});
