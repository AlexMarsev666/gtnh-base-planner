export function jsonLine(value: unknown): string;
export function props(
  text: string,
  open: number,
): { key: string; start: number; end: number; valueStart: number }[];
export function openOf(text: string, path: string[]): number;
export function removeProp(text: string, open: number, key: string): string;
export function setProp(
  text: string,
  open: number,
  key: string,
  value: unknown,
  options?: { before?: string },
): string;
export function legendOpen(text: string, ch: string): number;
