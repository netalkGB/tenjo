import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer, type ResolvedFileLink } from '../markdown-renderer';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { messages: {} }
  })
}));

describe('MarkdownRenderer', () => {
  it('shows the resolved PDF filename instead of an arbitrary markdown label', () => {
    const uuid = '20cad8e5-f3be-4a66-a996-71084958eed6';
    const resolveFileLink = (href: string): ResolvedFileLink | null =>
      href === 'report.pdf'
        ? {
            url: '/download/report.pdf',
            name: 'report.pdf',
            onOpen: vi.fn()
          }
        : null;

    render(
      <MarkdownRenderer
        markdown={`[${uuid}](report.pdf)`}
        resolveFileLink={resolveFileLink}
      />
    );

    const link = screen.getByRole('link', { name: 'report.pdf' });
    expect(link).toHaveAttribute('href', '/download/report.pdf');
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });

  it('shows the resolved download filename for non-previewable artifacts', () => {
    const resolveFileLink = (href: string): ResolvedFileLink | null =>
      href === 'chart.png'
        ? {
            url: '/download/chart.png',
            name: 'chart.png'
          }
        : null;

    render(
      <MarkdownRenderer
        markdown="[open](chart.png)"
        resolveFileLink={resolveFileLink}
      />
    );

    const link = screen.getByRole('link', { name: 'chart.png' });
    expect(link).toHaveAttribute('href', '/download/chart.png');
    expect(link).toHaveAttribute('download', 'chart.png');
  });

  it('opens the in-app preview for previewable artifacts', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const resolveFileLink = (href: string): ResolvedFileLink | null =>
      href === 'sample.pdf'
        ? {
            url: '/download/sample.pdf',
            name: 'sample.pdf',
            onOpen
          }
        : null;

    render(
      <MarkdownRenderer
        markdown="`sample.pdf`"
        resolveFileLink={resolveFileLink}
      />
    );

    const link = screen.getByRole('link', { name: 'sample.pdf' });
    expect(link).toHaveAttribute('href', '/download/sample.pdf');

    await user.click(link);

    expect(onOpen).toHaveBeenCalledOnce();
  });
});
