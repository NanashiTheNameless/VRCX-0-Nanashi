// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BadgeRuleGuide } from './BadgeRuleGuide';

const T = 'view.settings.appearance.user_badges';

describe('BadgeRuleGuide', () => {
    afterEach(cleanup);

    it('shows diagrams, explanations and the full truth table when expanded', () => {
        render(<BadgeRuleGuide />);
        expect(screen.queryByRole('table')).toBeNull();
        const toggle = screen.getByRole('button', { name: `${T}.guide.title` });
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getAllByRole('img')).toHaveLength(8);
        for (const operator of [
            'and',
            'or',
            'xor',
            'nand',
            'nor',
            'xnor',
            'xand',
            'not'
        ]) {
            expect(
                screen.getByText(`${T}.operator_description.${operator}`)
            ).toBeTruthy();
        }
        const rows = within(screen.getByRole('table')).getAllByRole('row');
        expect(
            rows
                .slice(1)
                .map((row) =>
                    Array.from(row.children, (cell) => cell.textContent)
                )
        ).toEqual([
            ['0', '0', '0', '0', '0', '1', '1', '1', '1', '1'],
            ['0', '1', '1', '0', '1', '1', '0', '0', '0', '1'],
            ['1', '0', '1', '0', '1', '1', '0', '0', '0', '0'],
            ['1', '1', '1', '1', '0', '0', '0', '1', '1', '0']
        ]);
        fireEvent.click(toggle);
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('updates every visual result when the example inputs change', () => {
        render(<BadgeRuleGuide />);
        fireEvent.click(
            screen.getByRole('button', { name: `${T}.guide.title` })
        );
        const diagram = (operator: string) =>
            screen.getByRole('img', { name: new RegExp(`^${operator}:`) });
        const result = (operator: string) =>
            diagram(operator).getAttribute('aria-label')?.split(', ').at(-1);
        expect(result('AND')).toBe(`${T}.guide.no_match`);
        expect(result('XOR')).toBe(`${T}.guide.matches`);
        fireEvent.click(
            screen.getByRole('checkbox', { name: `${T}.guide.input_b` })
        );
        expect(result('AND')).toBe(`${T}.guide.matches`);
        expect(result('XOR')).toBe(`${T}.guide.no_match`);
        expect(result('XNOR')).toBe(`${T}.guide.matches`);
        expect(result('XAND')).toBe(result('XNOR'));
        expect(result('NOT')).toBe(`${T}.guide.no_match`);
        fireEvent.click(
            screen.getByRole('checkbox', { name: `${T}.guide.input_a` })
        );
        expect(result('AND')).toBe(`${T}.guide.no_match`);
        expect(result('XOR')).toBe(`${T}.guide.matches`);
        expect(result('NOT')).toBe(`${T}.guide.matches`);
    });
});
