// Runs the simulation server and the web client together (Ctrl+C stops both).
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '--workspace', '@morphis/server'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev', '--workspace', '@morphis/web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && stop()));
