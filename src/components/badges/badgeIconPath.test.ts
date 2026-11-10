import { createLucideIcon, Star, type IconNode } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { iconNodeOf, iconNodeToPath } from './badgeIconPath';

describe('iconNodeToPath', () => {
    it('reads the drawing behind Lucide and Lab style icons', () => {
        const star = iconNodeOf(Star);
        expect(star?.[0]?.[0]).toBe('path');
        const node: IconNode = [['circle', { cx: 12, cy: 12, r: 4 }]];
        expect(iconNodeOf(createLucideIcon('LabTest', node))).toEqual(node);
    });

    it('turns every shape into path data', () => {
        expect(
            iconNodeToPath([
                ['circle', { cx: 12, cy: 12, r: 4 }],
                ['line', { x1: 2, y1: 3, x2: 20, y2: 21 }],
                ['polyline', { points: '4 6 8 10 12 6' }],
                ['polygon', { points: '1,1 5,1 3,4' }],
                ['rect', { x: 2, y: 4, width: 20, height: 16 }],
                ['ellipse', { cx: 12, cy: 6, rx: 8, ry: 3 }]
            ])
        ).toBe(
            [
                'M 8 12 A 4 4 0 1 0 16 12 A 4 4 0 1 0 8 12 Z',
                'M 2 3 L 20 21',
                'M 4 6 L 8 10 L 12 6',
                'M 1 1 L 5 1 L 3 4 Z',
                'M 2 4 H 22 V 20 H 2 Z',
                'M 4 6 A 8 3 0 1 0 20 6 A 8 3 0 1 0 4 6 Z'
            ].join(' ')
        );
    });

    it('rounds rectangle corners with arcs', () => {
        expect(
            iconNodeToPath([
                ['rect', { x: 2, y: 2, width: 20, height: 10, rx: 2 }]
            ])
        ).toBe(
            'M 4 2 H 20 A 2 2 0 0 1 22 4 V 10 A 2 2 0 0 1 20 12 H 4 A 2 2 0 0 1 2 10 V 4 A 2 2 0 0 1 4 2 Z'
        );
    });

    it('keeps a path that starts with a relative move at its own origin', () => {
        expect(
            iconNodeToPath([
                ['path', { d: 'M1 1h2' }],
                ['path', { d: 'm5-6 1 2v3' }]
            ])
        ).toBe('M1 1h2 M 5 -6 l 1 2v3');
    });

    it('skips shapes it cannot draw', () => {
        expect(
            iconNodeToPath([
                ['circle', { cx: 1, cy: 1, r: 0 }],
                ['text' as 'path', {}],
                ['polyline', { points: '1 2' }]
            ])
        ).toBe('');
    });
});
