import { Button } from '@/ui/shadcn/button';

import type { useLoginPageController } from '../useLoginPageController';

type LoginActions = ReturnType<typeof useLoginPageController>['actions'];

export function LoginPageFooter({
    onOpenGithub,
    onOpenIssues
}: {
    onOpenGithub: LoginActions['openGithub'];
    onOpenIssues: LoginActions['openIssues'];
}) {
    return (
        <div className="text-muted-foreground/65 mt-4 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 text-center text-[0.7rem]">
            <div className="flex justify-end">
                <Button
                    type="button"
                    variant="link"
                    className="text-muted-foreground/75 h-auto p-0 text-[0.7rem]"
                    onClick={onOpenGithub}
                >
                    GitHub
                </Button>
            </div>
            <span aria-hidden="true">|</span>
            <div className="flex justify-start">
                <Button
                    type="button"
                    variant="link"
                    className="text-muted-foreground/75 h-auto p-0 text-[0.7rem]"
                    onClick={onOpenIssues}
                >
                    Issues
                </Button>
            </div>
        </div>
    );
}
