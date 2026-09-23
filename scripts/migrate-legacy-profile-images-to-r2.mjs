import { neon } from '@neondatabase/serverless';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const connection = String(process.env.NEON_DATABASE_URL || '').trim();
if (!connection) throw new Error('NEON_DATABASE_URL is required.');

const LEGACY_PREFIX = 'https://lbvxnbbglkjnwphaomyx.supabase.co/storage/v1/object/public/userflex-profile-images/';
const PUBLIC_ORIGIN = 'https://userflex-admin.luis5afp.workers.dev';
const BUCKET = 'userflex-profile-images';
const MAX_BYTES = 5 * 1024 * 1024;
const PATH_RE = /^profiles\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i;

const sql = neon(connection);
const rows = await sql`
  select id, image_url
  from userflex_profiles
  where image_url like ${LEGACY_PREFIX + '%'}
  order by id
`;

if (!rows.length) {
  console.log('No legacy profile images require migration.');
  process.exit(0);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'userflex-profile-images-'));
let migrated = 0;

try {
  for (const row of rows) {
    const oldUrl = String(row.image_url || '');
    const objectPath = decodeURIComponent(oldUrl.slice(LEGACY_PREFIX.length));
    if (!PATH_RE.test(objectPath)) {
      throw new Error(`Unexpected legacy profile image path: ${objectPath}`);
    }

    const response = await fetch(oldUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Could not download legacy profile image ${row.id}: HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error(`Legacy profile image ${row.id} is not an image.`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) {
      throw new Error(`Legacy profile image ${row.id} has invalid size ${bytes.byteLength}.`);
    }

    const localPath = path.join(tempRoot, path.basename(objectPath));
    await writeFile(localPath, bytes);

    const args = [
      'wrangler@4.130.0',
      'r2',
      'object',
      'put',
      `${BUCKET}/${objectPath}`,
      '--file',
      localPath,
      '--content-type',
      contentType,
      '--cache-control',
      'public, max-age=31536000, immutable',
      '--remote',
    ];
    const result = spawnSync('npx', args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
    if (result.status !== 0) {
      throw new Error(`Cloudflare R2 upload failed for ${row.id}.`);
    }

    const encodedPath = objectPath.split('/').map((part) => encodeURIComponent(part)).join('/');
    const newUrl = `${PUBLIC_ORIGIN}/api/profile-image-files/${encodedPath}`;
    await sql`
      update userflex_profiles
      set image_url = ${newUrl},
          updated_at = now()
      where id = ${row.id}
        and image_url = ${oldUrl}
    `;
    migrated += 1;
    console.log(`Migrated profile image ${row.id} -> ${objectPath}`);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log(`Legacy profile image migration complete: ${migrated} image(s).`);
