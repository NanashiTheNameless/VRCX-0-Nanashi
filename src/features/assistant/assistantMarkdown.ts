import type { UIMessage } from '@/domain/assistant/types';

/** One message as Markdown: its text as written (assistant replies already are). */
export function messageMarkdown(message: UIMessage): string {
    return message.text.trim();
}

/**
 * The conversation as one Markdown document: a title, then each message
 * under a heading saying who wrote it. Messages with no text are skipped.
 */
export function chatMarkdown(
    title: string,
    messages: readonly UIMessage[],
    labels: { user: string; assistant: string }
): string {
    const parts = [`# ${title.trim() || labels.assistant}`];
    for (const message of messages) {
        const text = messageMarkdown(message);
        if (!text) {
            continue;
        }
        parts.push(
            `## ${message.role === 'user' ? labels.user : labels.assistant}`,
            text
        );
    }
    return `${parts.join('\n\n')}\n`;
}

/** Position of a user message among the session's user messages. */
export function userMessageIndex(
    messages: readonly UIMessage[],
    messageId: string
): number {
    let index = 0;
    for (const message of messages) {
        if (message.id === messageId) {
            return message.role === 'user' ? index : -1;
        }
        if (message.role === 'user') {
            index += 1;
        }
    }
    return -1;
}
