const fs = require('fs');
const path = require('path');

/*
 * Simple logger utility for the WhatsApp bot.
 *
 * Logs are appended to a file on disk and also echoed to stdout/stderr.  Each
 * entry includes a UTC timestamp and a log level.  By centralising logging
 * here we avoid sprinkling `console.log` statements throughout the code and
 * gain the ability to change log formats or destinations in one place.
 */

// Determine the base directory for logs.  The directory can be set via
// the LOG_DIR environment variable, otherwise it defaults to a `logs` folder
// in the current working directory.  The directory will be created on
// demand if it does not exist.
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'js.log');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore errors if the directory already exists
  }
}

/**
 * Writes a log entry to the configured file.  This function will synchronously
 * append to the log file.  Synchronous file writes are acceptable here
 * because logging is generally infrequent relative to other I/O and makes
 * error handling simpler.  Should you wish to optimise further you could
 * buffer writes or use an async API.
 *
 * @param {string} level The log level (e.g. "INFO", "ERROR").
 * @param {string} message The message to write.
 * @param {Error} [error] Optional error whose stack will be logged.
 */
function writeLog(level, message, error) {
  ensureDir(LOG_DIR);
  const timestamp = new Date().toISOString();
  const errorInfo = error ? `\n${error.stack || error.message || error}` : '';
  const line = `${timestamp} [${level}] ${message}${errorInfo}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // If writing to the log file fails we still want to see the message in
    // the console.  Avoid throwing here to prevent a logging failure from
    // crashing the application.
    console.error('Failed to write to log file:', e);
  }
  // Echo to console with appropriate method based on level
  if (level === 'ERROR') {
    console.error(line.trim());
  } else if (level === 'WARN') {
    console.warn(line.trim());
  } else {
    console.log(line.trim());
  }
}

module.exports = {
  /** Log an informational message. */
  info(message) {
    writeLog('INFO', message);
  },
  /** Log a warning message. */
  warn(message) {
    writeLog('WARN', message);
  },
  /** Log an error with optional error object. */
  error(message, error) {
    writeLog('ERROR', message, error);
  }
};