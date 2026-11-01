import { readdirSync, statSync, existsSync } from 'fs';
import { appendFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
const LOG_DIR = join(process.env.XDG_DATA_HOME || join(process.env.HOME || homedir(), '.local', 'share'), 'opencode', 'log');
function findCurrentLogFile() {
    try {
        if (!existsSync(LOG_DIR))
            return null;
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
    }
    catch {
        return null;
    }
}
// Resolve log file path at module load
let cachedLogFile = findCurrentLogFile();
function getLogFile() {
    if (cachedLogFile === null || !existsSync(cachedLogFile)) {
        // Re-scan if no file found at module load or if cached file was deleted (log rotation)
        cachedLogFile = findCurrentLogFile();
    }
    return cachedLogFile;
}
function formatLogLine(level, message) {
    const timestamp = new Date().toISOString();
    return `${level.padEnd(5)} ${timestamp} +0ms service=omniroute ${message}\n`;
}
export function warn(message) {
    const logFile = getLogFile();
    if (!logFile)
        return;
    const line = formatLogLine('WARN', message);
    // Fire-and-forget: don't await, don't crash on error
    appendFile(logFile, line).catch(() => { });
}
/**
 * Render an unknown thrown value as a readable message.
 *
 * `String(error)` yields `"[object Object]"` for thrown non-Error values, which
 * hides the real cause in logs. Errors keep their name, plain objects are
 * JSON-encoded, and everything else falls back to `String`.
 */
export function describeError(error) {
    if (error instanceof Error) {
        return error.message ? `${error.name}: ${error.message}` : error.name;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object') {
        try {
            const json = JSON.stringify(error);
            if (json && json !== '{}')
                return json;
        }
        catch {
            // Circular structure: fall through to the message/string fallbacks.
        }
        const message = error.message;
        if (typeof message === 'string' && message)
            return message;
    }
    return String(error);
}
export function debug(message) {
    // Strict comparison: only "1" enables debug logging
    if (process.env.OMNIROUTE_DEBUG !== '1')
        return;
    const logFile = getLogFile();
    if (!logFile)
        return;
    const line = formatLogLine('DEBUG', message);
    appendFile(logFile, line).catch(() => { });
}
//# sourceMappingURL=logger.js.map