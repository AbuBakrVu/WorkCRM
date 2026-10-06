// Горячая резервная копия базы: npm run backup  → data/backups/crm-YYYY-MM-DD_HH-MM.db
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

const dir = path.join(process.env.DATA_DIR || path.resolve('data'), 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
const file = path.join(dir, `crm-${stamp}.db`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

// Храним последние 14 копий
const files = fs.readdirSync(dir).filter((f) => f.startsWith('crm-') && f.endsWith('.db')).sort();
for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(dir, f));
console.log('Резервная копия:', file);
