import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lockPath = 'node_modules/.package-lock.json';
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

if (!lock.packages) {
  lock.packages = {};
}

const packages = lock.packages;

const rootEntry = {
  name: pkg.name,
  version: pkg.version,
  dependencies: pkg.dependencies ?? {},
  devDependencies: pkg.devDependencies ?? {},
};
packages[''] = rootEntry;

const topLevelDeps = {};

const normalizeVersion = (range) => {
  if (typeof range !== 'string') return range;
  const orParts = range.split('||').map((part) => part.trim());
  const primary = orParts[0];
  const matched = primary.match(/[0-9][0-9a-zA-Z.\-+]*/);
  return matched ? matched[0] : primary;
};

const tarballUrl = (name, version) => {
  if (!version) return undefined;
  if (name.startsWith('@')) {
    const [, pkgName] = name.split('/');
    return `https://registry.npmjs.org/${name}/-/${pkgName}-${version}.tgz`;
  }
  return `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
};

const ensurePackageEntry = (name, range, isDev) => {
  const key = `node_modules/${name}`;
  let entry = packages[key];
  if (!entry) {
    const version = normalizeVersion(range);
    entry = { version };
    const resolved = tarballUrl(name, version);
    if (resolved) {
      entry.resolved = resolved;
    }
    if (isDev) {
      entry.dev = true;
    }
    packages[key] = entry;
  } else {
    if (!entry.version) {
      entry.version = normalizeVersion(range);
    }
    if (!entry.resolved) {
      const resolved = tarballUrl(name, entry.version);
      if (resolved) {
        entry.resolved = resolved;
      }
    }
    if (isDev && entry.dev !== true) {
      entry.dev = true;
    }
  }
  return entry;
};

const assignTopLevel = (collection, isDev) => {
  for (const [name, range] of Object.entries(collection ?? {})) {
    const entry = ensurePackageEntry(name, range, isDev);
    const result = { version: entry.version };
    if (entry.resolved) {
      result.resolved = entry.resolved;
    }
    if (entry.integrity) {
      result.integrity = entry.integrity;
    }
    if (entry.requires) {
      result.requires = entry.requires;
    }
    if (isDev) {
      result.dev = true;
    }
    topLevelDeps[name] = result;
  }
};

assignTopLevel(pkg.dependencies, false);
assignTopLevel(pkg.devDependencies, true);

lock.dependencies = topLevelDeps;

writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
