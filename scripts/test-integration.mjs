import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  RUN_CLOSEMONTH_LOCKING_IT: '1',
  NO_COLOR: process.env.NO_COLOR ?? '1',
};

const specPaths = [
  'backend/src/app/expenses/close-month-locking.integration.spec.ts',
];

const args = [
  './node_modules/jest/bin/jest.js',
  '-c',
  'backend/jest.config.cts',
  '--runInBand',
  ...specPaths,
];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
