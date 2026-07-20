import type { DesktopCapturerSource } from 'electron';

export function sourceId(source: Pick<DesktopCapturerSource, 'id'>): string {
  return source.id;
}
