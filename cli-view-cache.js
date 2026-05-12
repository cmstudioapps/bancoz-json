#!/usr/bin/env node
process.argv.splice(2, 0, 'view-cache');
await import('./cli.js');
