import type { BrowserAction } from './types.js';

const REDACTED = '[redacted]';

export function redactBrowserAction(action: BrowserAction | undefined): BrowserAction | undefined {
  if (action === undefined) {
    return undefined;
  }

  switch (action.type) {
    case 'fill':
      return { ...action, value: REDACTED };
    case 'remoteSelect':
      return {
        ...action,
        query: REDACTED,
        option: action.option === undefined ? undefined : REDACTED,
      };
    case 'uploadFile':
      return { ...action, path: REDACTED };
    default:
      return action;
  }
}

export function redactBrowserActionInMessage(message: string): string {
  return message.replace(/path=[^\s)]+/gu, 'path=[redacted]');
}
