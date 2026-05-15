import { appendFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || homedir(), '.local', 'share'),
  'opencode',
  'log'
);

function findCurrentLogFile(): string | null {
  try {
    if (!existsSync(LOG_DIR)) return null;

    const files = readdirSync(LOG_DIR)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const path = join(LOG_DIR, f);
        const stat = statSync(path);
        return { path, mtime: stat.mtime.getTime(), isFile: stat.isFile() };
      })
      .filter((f) => f.isFile)
      .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));

    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

// Resolve log file path at module load
let cachedLogFile: string | null = findCurrentLogFile();

function getLogFile(): string | null {
  if (cachedLogFile === null) {
    // Re-scan if no file found at module load (OpenCode may create one later)
    cachedLogFile = findCurrentLogFile();
  }
  return cachedLogFile;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string'
  );
}

function writeLog(level: string, message: string): void {
  let logFile = getLogFile();
  if (!logFile) return;

  // Check if cached file still exists (handles log rotation)
  if (!existsSync(logFile)) {
    cachedLogFile = findCurrentLogFile();
    logFile = cachedLogFile;
    if (!logFile) return;
  }

  const timestamp = new Date().toISOString();
  const line = `${level.padEnd(5)} ${timestamp} +0ms service=omniroute ${message}\n`;

  try {
    appendFileSync(logFile, line);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      // Log file was deleted, re-scan
      cachedLogFile = findCurrentLogFile();
      // Retry once with new file
      const newLogFile = cachedLogFile;
      if (newLogFile) {
        try {
          appendFileSync(newLogFile, line);
        } catch {
          // Silently fail on second attempt
        }
      }
    }
    // Silently fail for all other errors
  }
}

export function warn(message: string): void {
  writeLog('WARN', message);
}

export function debug(message: string): void {
  // Strict comparison: only "1" enables debug logging
  if (process.env.OMNIROUTE_DEBUG !== '1') return;
  writeLog('DEBUG', message);
}
