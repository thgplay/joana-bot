#!/usr/bin/env node
/*
 * A simple log viewer for Joana's bot.  This utility tails a log file and
 * prints new lines to stdout as they arrive.  It uses Node's fs.watchFile
 * rather than spawning a `tail -f` process so it works across operating
 * systems.  Usage:
 *
 *   node view_logs.js /path/to/logfile.log
 *
 * If no file is provided the script defaults to `logs/js.log` in the
 * current working directory.  Press Ctrl+C to exit.
 */

const fs = require('fs');
const path = require('path');

const logPath = process.argv[2] || path.join(process.cwd(), 'logs', 'js.log');

function watchLog(file) {
  let lastSize = 0;
  console.log(`🔍 Acompanhando log: ${file}`);
  // Initialise lastSize with the current file size if the file exists.
  try {
    const stats = fs.statSync(file);
    lastSize = stats.size;
  } catch {
    // file may not exist yet; that's ok, we'll catch up when it appears
    lastSize = 0;
  }

  fs.watchFile(file, { interval: 500 }, (curr, prev) => {
    // If the file shrank or was truncated, reset the pointer
    if (curr.size < lastSize) {
      lastSize = 0;
    }
    if (curr.size > lastSize) {
      const stream = fs.createReadStream(file, { start: lastSize, end: curr.size });
      stream.on('data', data => process.stdout.write(data.toString()));
      lastSize = curr.size;
    }
  });
}

watchLog(logPath);