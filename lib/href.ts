export function recordHref(base: string, id: string): string {
  return `${base}/${encodeURIComponent(id)}`;
}

export function readParamId(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
