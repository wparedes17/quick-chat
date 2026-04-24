// Minimal, dependency-free markdown renderer for chat messages.
// Supports: headings, bold, italic, inline code, code blocks, links, lists, line breaks.

import { Fragment, ReactNode } from "react";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline formatting -> array of ReactNodes
const renderInline = (text: string, keyBase: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  // Order matters: code, bold, italic, link
  const regex =
    /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*|_([^_]+)_)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="px-1 py-0.5 rounded bg-background/40 text-[0.85em] font-mono"
        >
          {m[2]}
        </code>,
      );
    } else if (m[4] !== undefined) {
      nodes.push(<strong key={key}>{m[4]}</strong>);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      nodes.push(<em key={key}>{m[6] ?? m[7]}</em>);
    } else if (m[9] !== undefined && m[10] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={m[10]}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {m[9]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

interface Props {
  content: string;
}

export const Markdown = ({ content }: Props) => {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-2 p-3 rounded-lg bg-background/40 text-xs font-mono overflow-x-auto"
        >
          <code dangerouslySetInnerHTML={{ __html: escapeHtml(buf.join("\n")) }} />
        </pre>,
      );
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level === 1
          ? "text-base font-semibold mt-2 mb-1"
          : level === 2
          ? "text-sm font-semibold mt-2 mb-1"
          : "text-sm font-medium mt-1 mb-1";
      const Tag = (`h${level}` as unknown) as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={key++} className={cls}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // List (consecutive - or * or 1. lines)
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && /^(\s*)([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^(\s*)([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={key++}
          className={`my-1 ${ordered ? "list-decimal" : "list-disc"} pl-5 space-y-0.5`}
        >
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li-${key}-${idx}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Blank line -> spacer
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1 whitespace-pre-wrap break-words">
        {para.map((p, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(p, `p-${key}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="text-sm leading-relaxed">{blocks}</div>;
};
