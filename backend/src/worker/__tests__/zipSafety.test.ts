/**
 * Zip-slip guard (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P5).
 *
 * The archive tests build REAL zip files byte by byte and run the real
 * central-directory parser over them, so the guard is proven against actual
 * archives rather than a hand-written entry list.
 *
 * The zips are constructed in-process rather than by shelling out to `zip`.
 * That is deliberate: the alpine images this runs in have no `zip` at all and
 * only BusyBox `unzip`, so a test that needed either would either fail or, worse,
 * skip silently and report a pass for a guard it never exercised.
 */

import { expect } from 'chai';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';
import { assertEntryPathsSafe, assertZipEntriesStayInside, listZipEntryNames, UnsafeArchiveError } from '../zipSafety.js';

const EXTRACT_DIR = '/tmp/obb-extract';

/**
 * Minimal zip writer: local header + data per entry, then a central directory.
 * Entry names are written verbatim, which is the whole point — it can emit the
 * `../` names a normal archiver refuses to create.
 */
function buildZip(
  entries: Array<{ name: string; body: string }>,
  opts: { dataDescriptors?: boolean } = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.body, 'utf8');
    const deflated = deflateRawSync(raw);
    const sum = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    // Flag bit 3 = sizes/CRC follow the data in a descriptor, which is what a
    // streaming writer emits when it cannot know the size up front. The local
    // header's size fields are then zero and only the central directory is
    // authoritative — the reason the parser reads the central directory.
    local.writeUInt16LE(opts.dataDescriptors ? 0x08 : 0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(opts.dataDescriptors ? 0 : sum, 14);
    local.writeUInt32LE(opts.dataDescriptors ? 0 : deflated.length, 18);
    local.writeUInt32LE(opts.dataDescriptors ? 0 : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, deflated);
    if (opts.dataDescriptors) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(sum, 4);
      descriptor.writeUInt32LE(deflated.length, 8);
      descriptor.writeUInt32LE(raw.length, 12);
      locals.push(descriptor);
      offset += descriptor.length;
    }

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + deflated.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

describe('zip entry path policy', () => {
  it('accepts the shape GitHub zipballs actually have', () => {
    expect(() => assertEntryPathsSafe([
      'owner-repo-abc1234/',
      'owner-repo-abc1234/package.json',
      'owner-repo-abc1234/src/index.ts',
      'owner-repo-abc1234/src/nested/deep/file.ts',
      '',
    ], EXTRACT_DIR)).to.not.throw();
  });

  it('rejects a traversal entry', () => {
    for (const entry of ['../evil.txt', 'a/../../evil.txt', '../../../../etc/crontab', 'ok/../../../out.txt']) {
      expect(() => assertEntryPathsSafe([entry], EXTRACT_DIR), entry).to.throw(UnsafeArchiveError, /escapes the extraction directory/);
    }
  });

  it('rejects absolute and Windows-style entries', () => {
    for (const entry of ['/etc/passwd', 'C:\\Windows\\System32\\evil.dll', '\\\\server\\share\\evil']) {
      expect(() => assertEntryPathsSafe([entry], EXTRACT_DIR), entry).to.throw(UnsafeArchiveError, /absolute entry path/);
    }
  });

  it('rejects a sibling directory that merely shares the root prefix', () => {
    // The bug a naive `startsWith(root)` check has: /tmp/obb-extract-evil is
    // NOT inside /tmp/obb-extract, but it does start with that string.
    expect(() => assertEntryPathsSafe(['../obb-extract-evil/payload.sh'], EXTRACT_DIR))
      .to.throw(UnsafeArchiveError);
  });

  it('accepts an entry that resolves exactly to the root', () => {
    expect(() => assertEntryPathsSafe(['.'], EXTRACT_DIR)).to.not.throw();
  });

  it('rejects the whole archive if even one entry is bad', () => {
    expect(() => assertEntryPathsSafe([
      'owner-repo-abc/package.json',
      'owner-repo-abc/src/index.ts',
      '../../evil.sh',
    ], EXTRACT_DIR)).to.throw(UnsafeArchiveError);
  });
});

describe('zip-slip guard against real crafted archives', () => {
  let work: string;
  const write = (name: string, bytes: Buffer): string => {
    const full = path.join(work, name);
    writeFileSync(full, bytes);
    return full;
  };

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'obb-zipslip-'));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('reads entry names out of a GitHub-zipball-shaped archive', async () => {
    const zipPath = write('repo.zip', buildZip([
      { name: 'owner-repo-abc1234/', body: '' },
      { name: 'owner-repo-abc1234/package.json', body: '{}\n' },
      { name: 'owner-repo-abc1234/src/index.ts', body: 'export const x = 1;\n' },
    ]));
    expect(await listZipEntryNames(zipPath)).to.deep.equal([
      'owner-repo-abc1234/',
      'owner-repo-abc1234/package.json',
      'owner-repo-abc1234/src/index.ts',
    ]);
    await assertZipEntriesStayInside(zipPath, path.join(work, 'extracted'));
  });

  it('reads a streaming zip that uses data descriptors — GitHub generates zipballs on the fly', async () => {
    // Cross-checked once by hand against Info-ZIP, python's zipfile, and a
    // python data-descriptor zip; this keeps the streaming shape covered without
    // needing either tool installed in the container.
    const zipPath = write('stream.zip', buildZip(
      [
        { name: 'owner-repo-abc/package.json', body: '{}\n' },
        { name: 'owner-repo-abc/src/big.ts', body: 'x'.repeat(5000) },
      ],
      { dataDescriptors: true },
    ));
    expect(await listZipEntryNames(zipPath)).to.deep.equal([
      'owner-repo-abc/package.json',
      'owner-repo-abc/src/big.ts',
    ]);
  });

  it('refuses a streaming archive whose entry escapes', async () => {
    const zipPath = write('stream-evil.zip', buildZip(
      [{ name: '../../evil.sh', body: 'pwned\n' }],
      { dataDescriptors: true },
    ));
    let threw: unknown = null;
    try {
      await assertZipEntriesStayInside(zipPath, path.join(work, 'extracted'));
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(UnsafeArchiveError);
  });

  it('refuses an archive whose entry escapes the extraction directory', async () => {
    const zipPath = write('evil.zip', buildZip([
      { name: 'owner-repo-abc/package.json', body: '{}\n' },
      { name: '../../evil.sh', body: 'pwned\n' },
    ]));
    // Vacuity check: the crafted archive really does carry the traversal name.
    expect(await listZipEntryNames(zipPath)).to.include('../../evil.sh');

    let threw: unknown = null;
    try {
      await assertZipEntriesStayInside(zipPath, path.join(work, 'extracted'));
    } catch (err) {
      threw = err;
    }
    expect(threw, 'guard did not reject the malicious archive').to.be.instanceOf(UnsafeArchiveError);
    // And nothing was written, because we never extracted.
    expect(existsSync(path.join(work, 'evil.sh'))).to.equal(false);
  });

  it('refuses an archive with an absolute entry', async () => {
    const zipPath = write('abs.zip', buildZip([{ name: '/etc/cron.d/pwn', body: 'x\n' }]));
    let threw: unknown = null;
    try {
      await assertZipEntriesStayInside(zipPath, path.join(work, 'extracted'));
    } catch (err) {
      threw = err;
    }
    expect(threw).to.be.instanceOf(UnsafeArchiveError);
  });

  it('fails closed on a corrupt or non-zip file rather than extracting it unchecked', async () => {
    const cases = [
      { name: 'garbage.zip', bytes: Buffer.from('this is not a zip file at all, not even close') },
      { name: 'tiny.zip', bytes: Buffer.from('PK') },
      // Valid EOCD, but the central directory points past the end of the file.
      { name: 'liar.zip', bytes: (() => {
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(999_999, 12);
        eocd.writeUInt32LE(999_999, 16);
        return eocd;
      })() },
    ];
    for (const testCase of cases) {
      const zipPath = write(testCase.name, testCase.bytes);
      let threw: unknown = null;
      try {
        await listZipEntryNames(zipPath);
      } catch (err) {
        threw = err;
      }
      expect(threw, `${testCase.name} should be refused`).to.be.instanceOf(UnsafeArchiveError);
    }
  });

  it('does not depend on an external unzip binary', () => {
    // The worker image ships BusyBox `unzip`, whose applet has no `-Z` zipinfo
    // mode, so a listing built on that flag passed on a developer's Info-ZIP
    // build and would have thrown on every real import. The parser must stay
    // self-contained. Asserted on the import (not on any mention of the flag —
    // the module's own comment explains this history and would trip that).
    const source = readFileSync(fileURLToPath(new URL('../zipSafety.ts', import.meta.url)), 'utf8');
    expect(source, 'zipSafety must not spawn a subprocess').to.not.match(/from 'node:child_process'/);
  });
});
