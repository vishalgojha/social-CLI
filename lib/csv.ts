function parseCsvText(text) {
  const s = String(text || '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      field = '';
      const trimmed = row.map((v) => String(v).trim());
      // Skip empty lines.
      if (trimmed.some((v) => v.length)) rows.push(trimmed);
      row = [];
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    field += ch;
  }

  // Last field/row
  row.push(field);
  const trimmed = row.map((v) => String(v).trim());
  if (trimmed.some((v) => v.length)) rows.push(trimmed);

  return rows;
}

function csvToObjects(text) {
  const rows = parseCsvText(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = r[i] !== undefined ? r[i] : '';
    });
    return obj;
  });
}

module.exports = {
  parseCsvText,
  csvToObjects
};

