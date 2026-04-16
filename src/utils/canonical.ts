const EXCLUDED_KEYS = new Set(['created_at', 'updated_at']);

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return obj.replace(/\s+/g, ' ').trim();
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    if (EXCLUDED_KEYS.has(key)) continue;
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalize(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(obj));
}
