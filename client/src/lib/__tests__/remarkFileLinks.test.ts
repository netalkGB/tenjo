import { describe, it, expect } from 'vitest';
import { remarkFileLinks } from '../remarkFileLinks';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const resolve = (href: string) =>
  href.replace(/^\.\//, '') === 'report.pdf' ||
  href.replace(/^\.\//, '') === '川柳.pdf' ||
  href === '/workspace/speedup_5s.mp4'
    ? { url: '/download', name: 'report.pdf' }
    : null;

function transform(tree: MdNode): MdNode {
  remarkFileLinks(resolve)(tree);
  return tree;
}

describe('remarkFileLinks', () => {
  it('wraps a resolvable inline-code mention in a link', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'inlineCode', value: 'report.pdf' }]
        }
      ]
    };
    transform(tree);
    const link = tree.children![0].children![0];
    expect(link.type).toBe('link');
    expect(link.url).toBe('report.pdf');
    expect(link.children![0]).toEqual({
      type: 'inlineCode',
      value: 'report.pdf'
    });
  });

  it('links bare-text mentions and leaves surrounding text intact', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: '出力は report.pdf です。notes.txt も参照' }
          ]
        }
      ]
    };
    transform(tree);
    const children = tree.children![0].children!;
    expect(children.map(node => node.type)).toEqual(['text', 'link', 'text']);
    expect(children[0].value).toBe('出力は ');
    expect(children[1].url).toBe('report.pdf');
    // notes.txt is not resolvable, so it stays plain text.
    expect(children[2].value).toBe(' です。notes.txt も参照');
  });

  it('links non-ASCII file names', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '川柳.pdf を作成しました。' }]
        }
      ]
    };
    transform(tree);
    expect(tree.children![0].children![0]).toMatchObject({
      type: 'link',
      url: '川柳.pdf'
    });
  });

  it('links absolute sandbox paths in bare text', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: '出力ファイル: /workspace/speedup_5s.mp4' }
          ]
        }
      ]
    };
    transform(tree);
    const children = tree.children![0].children!;
    expect(children.map(node => node.type)).toEqual(['text', 'link']);
    expect(children[1]).toMatchObject({
      type: 'link',
      url: '/workspace/speedup_5s.mp4'
    });
  });

  it('leaves fenced code blocks and existing links untouched', () => {
    const tree: MdNode = {
      type: 'root',
      children: [
        { type: 'code', value: 'cp report.pdf out/' },
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://example.com',
              children: [{ type: 'text', value: 'report.pdf' }]
            }
          ]
        }
      ]
    };
    const before = JSON.parse(JSON.stringify(tree));
    transform(tree);
    expect(tree).toEqual(before);
  });
});
