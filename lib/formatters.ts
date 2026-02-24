const chalk = require('chalk');
let Table = null;
try {
  // Optional: if dependencies are not installed yet, fall back to a simple formatter.
  // This keeps `meta` runnable in fresh clones without an install step.
  // eslint-disable-next-line global-require
  Table = require('cli-table3');
} catch {
  Table = null;
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function formatTable(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'No data to display';
  }

  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {});

  if (!Table) {
    // Minimal ASCII table fallback (no deps).
    const stringify = (v) => {
      if (v === null || v === undefined || v === '') return '-';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return String(v);
    };

    const widths = cols.map((c) => c.length);
    rows.forEach((r) => {
      cols.forEach((c, i) => {
        const s = stringify(r[c]);
        widths[i] = Math.max(widths[i], s.length);
      });
    });

    const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
    const sep = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
    const head = '| ' + cols.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
    const body = rows.map((r) => {
      const line = '| ' + cols.map((c, i) => pad(stringify(r[c]), widths[i])).join(' | ') + ' |';
      return line;
    }).join('\n');

    return [sep, head, sep, body, sep].join('\n');
  }

  const table = new Table({
    head: cols.map((c) => chalk.cyanBright(c)),
    style: { head: [], border: [] },
    wordWrap: true
  });

  rows.forEach((r) => {
    table.push(cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined || v === '') return chalk.gray('-');
      if (typeof v === 'boolean') return v ? chalk.green('true') : chalk.red('false');
      if (typeof v === 'number') return String(v);
      return String(v);
    }));
  });

  return table.toString();
}

function formatKeyValue(data) {
  const lines = [];
  Object.entries(data || {}).forEach(([k, v]) => {
    lines.push(`${chalk.cyan(k + ':')} ${typeof v === 'object' ? '\n' + formatJson(v) : String(v)}`);
  });
  return lines.join('\n');
}

module.exports = {
  formatJson,
  formatTable,
  formatKeyValue
};
