import { memo } from 'react';

import type { UIMessage } from '@/domain/assistant/types';
import { Bubble, BubbleContent } from '@/ui/shadcn/bubble';
import { Marker, MarkerContent, MarkerIcon } from '@/ui/shadcn/marker';
import { Message, MessageContent } from '@/ui/shadcn/message';
import { Spinner } from '@/ui/shadcn/spinner';

import { AssistantMarkdown } from './AssistantMarkdown';
import { ToolCallStatus } from './ToolCallStatus';

interface AssistantMessageProps {
    message: UIMessage;
    thinkingLabel: string;
}

function AssistantMessageImpl({
    message,
    thinkingLabel
}: AssistantMessageProps) {
    const isUser = message.role === 'user';
    const hasVisibleText = message.text.trim().length > 0;
    const renderPlain = isUser || message.streaming;
    const alignment = isUser ? 'end' : 'start';

    return (
        <Message align={alignment}>
            <MessageContent>
                {message.toolCalls.map((call) => (
                    <ToolCallStatus key={call.id} toolCall={call} />
                ))}

                {hasVisibleText && (
                    <Bubble
                        align={alignment}
                        variant={isUser ? 'secondary' : 'ghost'}
                    >
                        <BubbleContent>
                            {renderPlain ? (
                                <span className="whitespace-pre-wrap">
                                    {message.text}
                                </span>
                            ) : (
                                <AssistantMarkdown text={message.text} />
                            )}
                            {message.streaming && (
                                <span
                                    aria-hidden="true"
                                    className="shimmer ml-1"
                                >
                                    ...
                                </span>
                            )}
                        </BubbleContent>
                    </Bubble>
                )}

                {message.streaming && !hasVisibleText && (
                    <Marker role="status">
                        <MarkerIcon>
                            <Spinner />
                        </MarkerIcon>
                        <MarkerContent className="shimmer">
                            {thinkingLabel}
                        </MarkerContent>
                    </Marker>
                )}

                {message.error && (
                    <Bubble align="start" variant="destructive">
                        <BubbleContent>{message.error}</BubbleContent>
                    </Bubble>
                )}
            </MessageContent>
        </Message>
    );
}

export const AssistantMessage = memo(AssistantMessageImpl);
