import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

const COPY_CONFIRMATION_TIMEOUT_MS = 2000;
const LANGUAGE_PATTERN = /language-(\w+)/;

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  node?: unknown;
}

function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const code = String(children).replace(/\n$/, '');
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_TIMEOUT_MS);
    } catch {
      // clipboard API failure is non-critical
    }
  };

  const match = LANGUAGE_PATTERN.exec(className || '');
  const language = match ? match[1] : '';

  return (
    <div className="relative group">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5 rounded-t-md">
        <span className="text-xs text-zinc-400 font-mono">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check size={14} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="mt-0! rounded-t-none! p-3!">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function isInlineCode(className?: string): boolean {
  return !LANGUAGE_PATTERN.test(className || '');
}

interface MarkdownRendererProps {
  markdown: string;
}

export function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  return (
    <div className="prose prose-base max-w-none dark:prose-invert prose-headings:font-bold prose-h1:text-4xl prose-h2:text-3xl prose-h3:text-2xl prose-h4:text-xl prose-p:my-5 prose-p:leading-relaxed prose-ul:my-5 prose-ol:my-5 prose-li:my-2 prose-table:my-6 prose-thead:bg-gray-100 dark:prose-thead:bg-gray-800 prose-th:border prose-th:border-gray-300 dark:prose-th:border-gray-600 prose-th:px-4 prose-th:py-2 prose-td:border prose-td:border-gray-300 dark:prose-td:border-gray-600 prose-td:px-4 prose-td:py-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          code({ children: markdown, className, node, ...props }) {
            if (isInlineCode(className)) {
              return (
                <code className={className} {...props}>
                  {markdown}
                </code>
              );
            }

            return (
              <CodeBlock className={className} node={node}>
                {markdown}
              </CodeBlock>
            );
          },
          pre({ children: markdown }) {
            return <>{markdown}</>;
          }
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
