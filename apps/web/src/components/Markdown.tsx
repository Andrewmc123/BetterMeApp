/**
 * Minimal markdown renderer for agent output — headings, lists, tables, bold,
 * inline code. Everything is escaped first, so no third-party sanitiser is
 * needed and no raw model output can inject markup.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

function toHtml(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.split("\n");
  let listType: "ul" | "ol" | null = null;
  let inTable = false;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      closeTable();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      closeList();
      closeTable();
      const level = Math.min(heading[1].length + 1, 5);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      closeList();
      closeTable();
      out.push("<hr />");
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      if (!inTable) {
        closeList();
        out.push(`<table><thead><tr>${cells.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`);
        inTable = true;
      } else {
        out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
      }
      continue;
    }
    closeTable();

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      const wanted = bullet ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
      continue;
    }
    closeList();

    out.push(`<p>${inline(trimmed)}</p>`);
  }

  closeList();
  closeTable();
  return out.join("\n");
}

export function Markdown({ text }: { text: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: toHtml(text ?? "") }} />;
}
