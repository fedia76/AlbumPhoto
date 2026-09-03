/** Génération d'identifiants portables (UUID v4 si disponible, sinon repli). */
export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  let out = '';
  for (let i = 0; i < 32; i++) {
    const n = Math.floor(Math.random() * 16);
    if (i === 12) out += '4';
    else if (i === 16) out += (8 + (n % 4)).toString(16);
    else out += n.toString(16);
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-';
  }
  return out;
}

/** Horodatage ISO 8601 (UTC). */
export function nowIso(): string {
  return new Date().toISOString();
}
