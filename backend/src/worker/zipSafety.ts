/**
 * Zip-slip guard for downloaded repository archives
 * (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P5).
 *
 * `unzip` is invoked in its array form, so there is no shell and no command
 * injection. What it does trust is the archive's own entry paths: an entry named
 * `../../etc/whatever` writes outside the extraction directory. GitHub zipballs
 * are well-formed today — every entry is prefixed `{owner}-{repo}-{sha}/` — so
 * this is defense in depth against the archive source changing, not a live
 * exploit.
 *
 * The check runs BEFORE extraction rather than cleaning up afterwards: an entry
 * that has already been written has already overwritten whatever it was aimed
 * at.
 *
 * Entry names are read by parsing the zip central directory here in Node rather
 * than by shelling out to `unzip -Z1`. That is not gold-plating: the worker image
 * (`backend/Dockerfile.worker`, alpine) ships **BusyBox** `unzip`, whose applet
 * supports only `[-lnojpqK]` — there is no `-Z` zipinfo mode, so a `-Z1`-based
 * check passed on a developer's macOS Info-ZIP build and would have thrown on
 * every real import in production. Parsing the format directly removes the
 * question of which `unzip` variant is installed, and costs no subprocess.
 *
 * This lives in its own module because `worker/index.ts` starts queue workers
 * and timers at import time, so a test could not import the guard from there
 * without booting the worker.
 */

import { open } from 'node:fs/promises';
import * as path from 'node:path';

/** Thrown when an archive is unsafe or cannot be inspected. */
export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeArchiveError';
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
/** EOCD is 22 bytes plus a comment of at most 0xffff. */
const MAX_EOCD_SEARCH = 22 + 0xffff;

/**
 * Validates already-listed entry names against an extraction root. Split from
 * the archive reading so the policy is testable without building a fixture
 * archive for every case.
 */
export function assertEntryPathsSafe(entries: string[], extractDir: string): void {
  const root = path.resolve(extractDir);
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === '') continue;
    // Absolute POSIX paths, Windows drive letters, and UNC-style paths.
    if (path.isAbsolute(entry) || /^[A-Za-z]:/.test(entry) || entry.startsWith('\\')) {
      throw new UnsafeArchiveError(`Refusing archive: absolute entry path ${JSON.stringify(entry.slice(0, 120))}`);
    }
    const target = path.resolve(root, entry);
    // `startsWith(root + sep)` and not `startsWith(root)`: the latter would
    // accept a sibling directory whose name merely begins with the root's
    // (`/tmp/extracted-evil` passes a naive prefix test on `/tmp/extracted`).
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new UnsafeArchiveError(
        `Refusing archive: entry escapes the extraction directory ${JSON.stringify(entry.slice(0, 120))}`,
      );
    }
  }
}

/**
 * Every entry name in a zip, read from its central directory.
 *
 * Fails closed: an archive whose structure cannot be parsed is refused rather
 * than extracted unchecked.
 */
export async function listZipEntryNames(zipPath: string): Promise<string[]> {
  const handle = await open(zipPath, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new UnsafeArchiveError('Refusing archive: too small to be a zip');

    // 1. End of central directory, scanned backwards from the file end.
    const tailLength = Math.min(size, MAX_EOCD_SEARCH);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) throw new UnsafeArchiveError('Refusing archive: no zip end-of-central-directory record');

    let entryCount = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    // 2. ZIP64, used once a repo exceeds 65535 files or 4 GiB. The sentinel
    //    values say "the real number is in the ZIP64 record".
    if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      let z64 = -1;
      for (let i = eocd - 56; i >= 0; i -= 1) {
        if (tail.readUInt32LE(i) === ZIP64_EOCD_SIGNATURE) {
          z64 = i;
          break;
        }
      }
      if (z64 === -1) throw new UnsafeArchiveError('Refusing archive: ZIP64 sentinel with no ZIP64 record');
      entryCount = Number(tail.readBigUInt64LE(z64 + 32));
      cdSize = Number(tail.readBigUInt64LE(z64 + 40));
      cdOffset = Number(tail.readBigUInt64LE(z64 + 48));
    }

    if (cdOffset + cdSize > size) throw new UnsafeArchiveError('Refusing archive: central directory runs past end of file');

    // 3. Walk the central directory, reading one name per record.
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const names: string[] = [];
    let at = 0;
    while (at + 46 <= cd.length && names.length <= entryCount) {
      if (cd.readUInt32LE(at) !== CENTRAL_FILE_SIGNATURE) break;
      const nameLength = cd.readUInt16LE(at + 28);
      const extraLength = cd.readUInt16LE(at + 30);
      const commentLength = cd.readUInt16LE(at + 32);
      const nameAt = at + 46;
      if (nameAt + nameLength > cd.length) {
        throw new UnsafeArchiveError('Refusing archive: truncated central directory entry');
      }
      names.push(cd.subarray(nameAt, nameAt + nameLength).toString('utf8'));
      at = nameAt + nameLength + extraLength + commentLength;
    }
    if (names.length < entryCount) {
      throw new UnsafeArchiveError(
        `Refusing archive: central directory declares ${entryCount} entries but only ${names.length} could be read`,
      );
    }
    return names;
  } finally {
    await handle.close();
  }
}

/** Reads a zip's entry names and rejects the archive if any would escape. */
export async function assertZipEntriesStayInside(zipPath: string, extractDir: string): Promise<void> {
  assertEntryPathsSafe(await listZipEntryNames(zipPath), extractDir);
}
