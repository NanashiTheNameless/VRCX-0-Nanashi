import { describe, expect, it } from 'vitest';

import type { UIMessage } from '@/domain/assistant/types';

import {
    chatMarkdown,
    messageMarkdown,
    userMessageIndex
} from './assistantMarkdown';

function message(id: string, role: UIMessage['role'], text: string): UIMessage {
    return { id, role, text, streaming: false, toolCalls: [] };
}

const messages = [
    message('u1', 'user', 'Who do I play with?'),
    message(
        'a1',
        'assistant',
        '| Friend | Hours |\n| --- | --- |\n| Alice | 12 |\n'
    ),
    message('a-empty', 'assistant', '   '),
    message('u2', 'user', 'And this week?'),
    message('a2', 'assistant', 'Mostly **Bob**.')
];

describe('assistant markdown', () => {
    it('normalizes assistant typography in copied replies while preserving user text and names', () => {
        const text =
            '**It\u2019s** \u201con\u201d\u2014wait\u2026\n\u2022 Caf\u00e9\u00a0\u2192 off';
        expect(messageMarkdown(message('a', 'assistant', text))).toBe(
            '**It\'s** "on" - wait...\n- Caf\u00e9 -> off'
        );
        expect(messageMarkdown(message('u', 'user', text))).toBe(text);
    });
    it('copies a message as the Markdown it was written in', () => {
        expect(messageMarkdown(messages[1])).toBe(
            '| Friend | Hours |\n| --- | --- |\n| Alice | 12 |'
        );
    });

    it('copies the chat under a title, labeling who wrote each message', () => {
        expect(
            chatMarkdown('Friends', messages, {
                user: 'You',
                assistant: 'AI Assistant'
            })
        ).toBe(
            [
                '# Friends',
                '## You',
                'Who do I play with?',
                '## AI Assistant',
                '| Friend | Hours |\n| --- | --- |\n| Alice | 12 |',
                '## You',
                'And this week?',
                '## AI Assistant',
                'Mostly **Bob**.'
            ].join('\n\n') + '\n'
        );
    });

    it('counts which user message is being edited', () => {
        expect(userMessageIndex(messages, 'u1')).toBe(0);
        expect(userMessageIndex(messages, 'u2')).toBe(1);
        expect(userMessageIndex(messages, 'a1')).toBe(-1);
        expect(userMessageIndex(messages, 'missing')).toBe(-1);
    });
});
