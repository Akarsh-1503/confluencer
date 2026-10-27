import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// schema.sql is read at runtime, so it has to land next to the compiled db/index.js.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'db', 'schema.sql');
const targetDir = path.join(root, 'dist', 'db');

await mkdir(targetDir, { recursive: true });
await cp(source, path.join(targetDir, 'schema.sql'));
console.log('[build] copied src/db/schema.sql -> dist/db/schema.sql');
