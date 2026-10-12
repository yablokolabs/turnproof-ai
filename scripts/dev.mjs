#!/usr/bin/env node
/**
 * Development launcher: runs the API and the Vite dev server in one foreground
 * process so a single Ctrl-C stops both. Nothing here is used in production or
 * in tests.
 */
import { spawn } from 'node:child_process';

const API_PORT = process.env.API_PORT ?? '4181';
const WEB_PORT = process.env.WEB_PORT ?? '5173';

const children = [];

function start(label, command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => {
    console.log(`[dev] ${label} exited with code ${code}`);
    stop(0);
  });
  children.push(child);
  return child;
}

function stop(code) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('api', 'npx', ['tsx', 'apps/api/src/server.ts'], { PORT: API_PORT });
start('web', 'npx', ['vite', '--config', 'apps/web/vite.config.ts', '--port', WEB_PORT], {
  VITE_API_TARGET: `http://127.0.0.1:${API_PORT}`,
});

console.log(`[dev] API on http://127.0.0.1:${API_PORT} - UI on http://127.0.0.1:${WEB_PORT}`);
console.log('[dev] Prototype - synthetic data - advisory only - no operational execution');
