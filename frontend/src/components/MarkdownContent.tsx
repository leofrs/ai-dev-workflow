import React from 'react';

interface MarkdownContentProps {
  content: string;
  size?: 'xs' | 'sm' | 'base';
  className?: string;
}

type TableAlignment = 'left' | 'center' | 'right';

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; headers: string[]; alignments: TableAlignment[]; rows: string[][] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string };

const SIZE_STYLES = {
  xs: {
    root: 'space-y-2.5 text-xs leading-relaxed text-foreground-secondary',
    h1: 'border-b border-line/70 pb-1 text-sm font-semibold text-foreground',
    h2: 'pt-1 text-[13px] font-semibold text-foreground',
    h3: 'text-xs font-semibold text-foreground',
    th: 'px-2.5 py-2 text-[11px] font-semibold text-foreground',
    td: 'px-2.5 py-2 text-xs text-foreground-secondary',
    codeBlock: 'p-2.5 text-[11px]'
  },
  sm: {
    root: 'space-y-3.5 text-sm leading-relaxed text-foreground-secondary',
    h1: 'border-b border-line/70 pb-1.5 text-lg font-semibold text-foreground',
    h2: 'pt-2 text-base font-semibold text-foreground',
    h3: 'pt-1 text-sm font-semibold text-foreground',
    th: 'px-3.5 py-2.5 text-xs font-semibold text-foreground',
    td: 'px-3.5 py-2.5 text-sm text-foreground-secondary',
    codeBlock: 'p-3.5 text-xs'
  },
  base: {
    root: 'space-y-4 text-base leading-relaxed text-foreground-secondary',
    h1: 'border-b border-line/70 pb-2 text-xl font-semibold text-foreground',
    h2: 'pt-2 text-lg font-semibold text-foreground',
    h3: 'pt-1 text-base font-semibold text-foreground',
    th: 'px-4 py-3 text-sm font-semibold text-foreground',
    td: 'px-4 py-3 text-sm text-foreground-secondary',
    codeBlock: 'p-4 text-sm'
  }
} as const;

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    trimmed = trimmed.slice(0, -1);
  }

  const cells: string[] = [];
  let current = '';
  let inCode = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function parseTableSeparator(line: string): TableAlignment[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) {
    return null;
  }

  const cells = splitTableRow(trimmed);
  if (cells.length === 0) {
    return null;
  }

  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) {
      return null;
    }
    if (cell.startsWith(':') && cell.endsWith(':')) {
      alignments.push('center');
    } else if (cell.endsWith(':')) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  }

  return alignments;
}

function isHorizontalRule(line: string): boolean {
  return /^\s*(?:[-*_]\s*){3,}$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const headerLine = lines[index].trim();
  const separatorLine = lines[index + 1].trim();
  if (!headerLine.includes('|')) return false;
  const alignments = parseTableSeparator(separatorLine);
  if (!alignments) return false;
  const headers = splitTableRow(headerLine);
  return headers.length === alignments.length && headers.length > 0;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = trimmed.match(/^```([\w-]*)\s*$/);
    if (fenceMatch) {
      const language = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2]
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (isHorizontalRule(rawLine)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // GFM Table
    if (isTableStart(lines, i)) {
      const headers = splitTableRow(lines[i]);
      const alignments = parseTableSeparator(lines[i + 1]) ?? headers.map(() => 'left');
      const rows: string[][] = [];
      i += 2;

      while (i < lines.length) {
        const rowTrimmed = lines[i].trim();
        if (!rowTrimmed || !rowTrimmed.includes('|')) {
          break;
        }
        const cells = splitTableRow(lines[i]);
        while (cells.length < headers.length) {
          cells.push('');
        }
        rows.push(cells.slice(0, headers.length));
        i++;
      }

      blocks.push({ type: 'table', headers, alignments, rows });
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(rawLine)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(rawLine)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(rawLine)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      const currentTrimmed = current.trim();
      if (
        !currentTrimmed ||
        /^```/.test(currentTrimmed) ||
        /^#{1,6}\s+/.test(currentTrimmed) ||
        isHorizontalRule(current) ||
        isTableStart(lines, i) ||
        /^\s*>\s?/.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+\.\s+/.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      i++;
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') });
    } else {
      i++;
    }
  }

  return blocks;
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://example.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(`[^`\n]+`|\*\*\*[^*\n]+?\*\*\*|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![A-Za-z0-9\\])\*[^*\n]+?\*(?![A-Za-z0-9])|(?<![A-Za-z0-9\\])_[^_\n]+?_(?![A-Za-z0-9]))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${tokenIndex++}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded border border-line/70 bg-surface-muted/80 px-1 py-0.5 font-mono text-[0.9em] text-foreground break-words"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('***') && token.endsWith('***')) {
      nodes.push(
        <strong key={key} className="font-semibold italic text-foreground">
          {renderInlineMarkdown(token.slice(3, -3), key)}
        </strong>
      );
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInlineMarkdown(token.slice(2, -2), key)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(
        <del key={key} className="text-foreground-muted line-through">
          {renderInlineMarkdown(token.slice(2, -2), key)}
        </del>
      );
    } else if (token.startsWith('[') && match[2] && match[3]) {
      const label = match[2];
      const href = match[3];
      if (isSafeUrl(href)) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-accent/50 underline-offset-2 hover:text-accent-strong"
          >
            {renderInlineMarkdown(label, key)}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      nodes.push(
        <em key={key} className="italic">
          {renderInlineMarkdown(token.slice(1, -1), key)}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function getAlignmentClass(alignment: TableAlignment | undefined): string {
  if (alignment === 'center') return 'text-center';
  if (alignment === 'right') return 'text-right';
  return 'text-left';
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  size = 'xs',
  className = ''
}) => {
  const styles = SIZE_STYLES[size];
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`min-w-0 break-words ${styles.root} ${className}`}>
      {blocks.map((block, index) => {
        const blockKey = `md-block-${index}`;

        switch (block.type) {
          case 'heading': {
            const headingClass =
              block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
            return (
              <div key={blockKey} className={headingClass}>
                {renderInlineMarkdown(block.text, blockKey)}
              </div>
            );
          }

          case 'code':
            return (
              <pre
                key={blockKey}
                className={`overflow-x-auto rounded-lg border border-line bg-surface font-mono text-foreground-secondary ${styles.codeBlock}`}
              >
                <code>{block.code}</code>
              </pre>
            );

          case 'table':
            return (
              <div
                key={blockKey}
                className="overflow-x-auto rounded-lg border border-line bg-panel/60"
              >
                <table className="w-full border-collapse text-left">
                  <thead className="border-b border-line bg-surface/90">
                    <tr>
                      {block.headers.map((header, colIdx) => (
                        <th
                          key={`${blockKey}-h-${colIdx}`}
                          className={`border-r border-line/70 last:border-r-0 align-top ${styles.th} ${getAlignmentClass(
                            block.alignments[colIdx]
                          )}`}
                        >
                          {renderInlineMarkdown(header, `${blockKey}-h-${colIdx}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {block.rows.map((row, rowIdx) => (
                      <tr
                        key={`${blockKey}-r-${rowIdx}`}
                        className="odd:bg-canvas/40 even:bg-surface/30"
                      >
                        {row.map((cell, colIdx) => (
                          <td
                            key={`${blockKey}-c-${rowIdx}-${colIdx}`}
                            className={`border-r border-line/60 last:border-r-0 align-top ${styles.td} ${getAlignmentClass(
                              block.alignments[colIdx]
                            )}`}
                          >
                            {renderInlineMarkdown(cell, `${blockKey}-c-${rowIdx}-${colIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'ul':
            return (
              <ul key={blockKey} className="list-disc space-y-1 pl-5">
                {block.items.map((item, itemIdx) => (
                  <li key={`${blockKey}-li-${itemIdx}`}>
                    {renderInlineMarkdown(item, `${blockKey}-li-${itemIdx}`)}
                  </li>
                ))}
              </ul>
            );

          case 'ol':
            return (
              <ol key={blockKey} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, itemIdx) => (
                  <li key={`${blockKey}-oli-${itemIdx}`}>
                    {renderInlineMarkdown(item, `${blockKey}-oli-${itemIdx}`)}
                  </li>
                ))}
              </ol>
            );

          case 'blockquote':
            return (
              <blockquote
                key={blockKey}
                className="border-l-2 border-accent-line/70 bg-surface/50 py-1.5 pl-3 pr-2 text-foreground-tertiary"
              >
                {block.lines.map((line, lineIdx) => (
                  <p key={`${blockKey}-q-${lineIdx}`}>
                    {renderInlineMarkdown(line, `${blockKey}-q-${lineIdx}`)}
                  </p>
                ))}
              </blockquote>
            );

          case 'hr':
            return <hr key={blockKey} className="border-line" />;

          case 'paragraph':
            return (
              <p key={blockKey} className="whitespace-pre-wrap">
                {renderInlineMarkdown(block.text, blockKey)}
              </p>
            );
        }
      })}
    </div>
  );
};
