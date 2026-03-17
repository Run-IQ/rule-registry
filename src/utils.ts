import type { RuleInput } from '@run-iq/context-engine';

// ─── ID generation ───────────────────────────────────────────────────────────

let idCounter = 0;

export function generateId(): string {
  idCounter++;
  return `reg-${Date.now()}-${idCounter}`;
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────

export function parseCSV(content: string): string[][] {
  const lines = content.trim().split(/\r?\n/);
  return lines.map((line) => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  });
}

export function csvRowToRuleInput(row: string[], headers: string[], tenantId: string): RuleInput {
  const get = (name: string): string => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] ?? '') : '';
  };

  const input: RuleInput = {
    model: get('model'),
    tenantId,
    scope: (get('scope') || 'tenant-specific') as RuleInput['scope'],
    effectiveFrom: get('effectiveFrom'),
    priority: Number(get('priority')) || 0,
    tags: get('tags') ? get('tags').split(';') : [],
    payload: get('payload'),
    createdBy: get('createdBy') || 'csv-import',
  };

  const mutable = input as unknown as Record<string, unknown>;
  const effectiveUntil = get('effectiveUntil');
  if (effectiveUntil) mutable['effectiveUntil'] = effectiveUntil;
  const country = get('country');
  if (country) mutable['country'] = country;
  const region = get('region');
  if (region) mutable['region'] = region;
  const description = get('description');
  if (description) mutable['description'] = description;

  return input;
}
