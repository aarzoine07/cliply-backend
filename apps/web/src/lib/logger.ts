export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export function logStub(_level: LogLevel, _msg: string, _data?: unknown): void {
  void _level;
  void _msg;
  void _data;
}
