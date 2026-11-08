import { CopyIcon, PencilIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { UIMessage } from '@/domain/assistant/types';
import { copyTextToClipboard } from '@/services/clipboardService';
import { toast } from '@/services/toastService';
import { Bubble, BubbleContent } from '@/ui/shadcn/bubble';
import { Button } from '@/ui/shadcn/button';
import { Message, MessageContent } from '@/ui/shadcn/message';
import { Textarea } from '@/ui/shadcn/textarea';

import { editUserMessage } from '../assistantActions';
import { messageMarkdown } from '../assistantMarkdown';
import { AssistantCharts } from './AssistantCharts';
import { AssistantChoiceCard } from './AssistantChoiceCard';
import { AssistantEditRequestCard } from './AssistantEditRequestCard';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantScreenshots } from './AssistantScreenshots';
import { AssistantTrace } from './AssistantTrace';
import { MentionText } from './MentionText';

interface AssistantMessageProps {
    message: UIMessage;
    thinkingLabel: string;
    /** False while a reply is being written, so messages cannot be edited. */
    editable?: boolean;
}

function MessageEditor({
    message,
    onDone
}: {
    message: UIMessage;
    onDone: () => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(message.text);
    const save = () => {
        if (!draft.trim() || draft.trim() === message.text.trim()) {
            onDone();
            return;
        }
        onDone();
        editUserMessage(message.id, draft).catch((error: unknown) => {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        });
    };
    return (
        <div className="flex w-full flex-col gap-2">
            <Textarea
                autoFocus
                rows={3}
                value={draft}
                aria-label={t('assistant.message.edit')}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        save();
                    } else if (event.key === 'Escape') {
                        onDone();
                    }
                }}
            />
            <p className="text-muted-foreground text-xs">
                {t('assistant.message.edit_hint')}
            </p>
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onDone}
                >
                    {t('common.actions.cancel')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    disabled={!draft.trim()}
                    onClick={save}
                >
                    {t('assistant.message.send_edit')}
                </Button>
            </div>
        </div>
    );
}

function MessageActions({
    message,
    editable,
    onEdit
}: {
    message: UIMessage;
    editable: boolean;
    onEdit: () => void;
}) {
    const { t } = useTranslation();
    const isUser = message.role === 'user';
    return (
        <div
            className={`flex gap-0.5 opacity-60 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 ${isUser ? 'justify-end' : ''}`}
        >
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('assistant.message.copy')}
                title={t('assistant.message.copy')}
                onClick={() =>
                    void copyTextToClipboard(messageMarkdown(message), {
                        successMessage: t('assistant.message.copied')
                    })
                }
            >
                <CopyIcon />
            </Button>
            {isUser && editable ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('assistant.message.edit')}
                    title={t('assistant.message.edit')}
                    onClick={onEdit}
                >
                    <PencilIcon />
                </Button>
            ) : null}
        </div>
    );
}

function AssistantMessageImpl({
    message,
    thinkingLabel,
    editable = true
}: AssistantMessageProps) {
    const [editing, setEditing] = useState(false);
    const isUser = message.role === 'user';
    const hasVisibleText = message.text.trim().length > 0;
    const alignment = isUser ? 'end' : 'start';
    const entities = useMemo(
        () => message.toolCalls.flatMap((call) => call.entities),
        [message.toolCalls]
    );
    const traceRunning =
        message.streaming &&
        (!hasVisibleText ||
            message.toolCalls.some((call) => call.status === 'pending'));

    return (
        <Message align={alignment} className="group/message">
            <MessageContent>
                {(message.toolCalls.length > 0 || traceRunning) && (
                    <AssistantTrace
                        toolCalls={message.toolCalls}
                        running={traceRunning}
                        thinkingLabel={thinkingLabel}
                    />
                )}

                {message.choices?.map((choice) => (
                    <AssistantChoiceCard
                        key={choice.id}
                        choice={choice}
                        active={message.streaming}
                    />
                ))}

                {message.editRequests?.map((request) => (
                    <AssistantEditRequestCard
                        key={request.id}
                        request={request}
                        active={message.streaming}
                    />
                ))}

                {editing ? (
                    <MessageEditor
                        message={message}
                        onDone={() => setEditing(false)}
                    />
                ) : null}

                {hasVisibleText && !editing && (
                    <Bubble
                        align={alignment}
                        variant={isUser ? 'muted' : 'ghost'}
                        className={
                            isUser
                                ? '*:data-[slot=bubble-content]:bg-(--state-pressed-surface)'
                                : undefined
                        }
                    >
                        <BubbleContent>
                            {isUser ? (
                                <MentionText text={message.text} />
                            ) : (
                                <AssistantMarkdown
                                    text={message.text}
                                    entities={entities}
                                    streaming={message.streaming}
                                />
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

                {hasVisibleText && !editing && !message.streaming && (
                    <MessageActions
                        message={message}
                        editable={editable}
                        onEdit={() => setEditing(true)}
                    />
                )}

                {!isUser && !message.streaming && (
                    <>
                        <AssistantScreenshots toolCalls={message.toolCalls} />
                        <AssistantCharts toolCalls={message.toolCalls} />
                    </>
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
