import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { mapConcurrent } from "./async-utils";

/**
 * Reads the syndication mirror from a local checkout (see
 * `scripts/setup-local-data.mjs`; the deploy workflow sparse-checks out `docs/`).
 * There is no network path — per-record directories have no index file, so they
 * cannot be discovered remotely.
 *
 * The mirror publishes big entities as one JSON document per record and small
 * ones as a single file, so `loadArray` supports both layouts. New stores should
 * be added as another loader in `dataSource` rather than by reading files
 * directly, so that path resolution and error handling stay in one place.
 */

/** Parallel reads for the many small files in the checkout. */
export const FILE_READ_CONCURRENCY = 64;

const JSON_SUFFIX = ".json";

const DATA_ROOT = resolve(
  process.cwd(),
  String(import.meta.env.DATA_LOCAL_DIR ?? "syndication-data/docs"),
);

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Reads a file, treating "does not exist" as `undefined` instead of an error. */
async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** `JSON.parse` does not name the offending file; with ~90k of them, it must. */
function parseJson(contents: string, location: string): unknown {
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Invalid JSON in ${location}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseArray<T>(contents: string, location: string): T[] {
  const data = parseJson(contents, location);
  if (!Array.isArray(data)) {
    throw new TypeError(`Expected a JSON array in ${location}`);
  }
  return data as T[];
}

function parseObject<T>(contents: string, location: string): T {
  const data = parseJson(contents, location);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError(`Expected a JSON object in ${location}`);
  }
  return data as T;
}

/** A per-record document holds either one entity or an array of them. */
function parseDocuments<T>(contents: string, location: string): T[] {
  const data = parseJson(contents, location);
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") return [data as T];
  throw new TypeError(`Expected a JSON object or array in ${location}`);
}

/**
 * Every JSON document in a data directory, in lexicographic filename order.
 * Returns `[]` when the directory does not exist — callers that require the
 * store to be present say so themselves.
 */
async function loadDirectory<T>(directory: string): Promise<T[]> {
  const directoryPath = resolve(DATA_ROOT, directory);

  let fileNames: string[];
  try {
    fileNames = (await readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_SUFFIX))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const documents = await mapConcurrent(
    fileNames,
    FILE_READ_CONCURRENCY,
    async (fileName): Promise<T[]> => {
      const path = resolve(directoryPath, fileName);
      const contents = await readOptionalFile(path);
      return contents === undefined ? [] : parseDocuments<T>(contents, path);
    },
  );
  return documents.flat();
}

/** A required store, published either as `<entity>.json` or as `<entity>/*.json`. */
async function loadArray<T>(entity: string): Promise<T[]> {
  const singleFile = resolve(DATA_ROOT, `${entity}${JSON_SUFFIX}`);
  const contents = await readOptionalFile(singleFile);
  if (contents !== undefined) return parseArray<T>(contents, singleFile);

  const shards = await loadDirectory<T>(entity);
  if (shards.length === 0) {
    throw new Error(
      `Missing data store: expected ${singleFile} or JSON shards in ${resolve(DATA_ROOT, entity)}`,
    );
  }
  return shards;
}

/**
 * Like `loadArray`, but `[]` when neither layout exists — for stores the mirror
 * started publishing after older checkouts were made.
 */
async function loadOptionalArray<T>(entity: string): Promise<T[]> {
  const singleFile = resolve(DATA_ROOT, `${entity}${JSON_SUFFIX}`);
  const contents = await readOptionalFile(singleFile);
  if (contents !== undefined) return parseArray<T>(contents, singleFile);
  return loadDirectory<T>(entity);
}

/** A required store published as a single JSON object keyed by entity id. */
async function loadRecord<T>(
  name: string,
): Promise<Record<string, T | undefined>> {
  const path = resolve(DATA_ROOT, `${name}${JSON_SUFFIX}`);
  return parseObject<Record<string, T | undefined>>(
    await readFile(path, "utf8"),
    path,
  );
}

/** An optional JSON object, used for data artifacts added after older checkouts. */
async function loadOptionalObject<T>(name: string): Promise<T | undefined> {
  const path = resolve(DATA_ROOT, `${name}${JSON_SUFFIX}`);
  const contents = await readOptionalFile(path);
  return contents === undefined ? undefined : parseObject<T>(contents, path);
}

/** Extracted PDF text; missing files are expected and tolerated. */
async function loadText(fileId: string): Promise<string | undefined> {
  return readOptionalFile(resolve(DATA_ROOT, "file-contents", `${fileId}.txt`));
}

export const dataSource = {
  loadArray,
  loadOptionalArray,
  loadDirectory,
  loadRecord,
  loadOptionalObject,
  loadText,
};
