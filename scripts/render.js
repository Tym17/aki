#!/usr/bin/env node
/**
 * Render a Markdown file into a standalone HTML page through an EJS template.
 *
 *   node render.js <input.md> <template.ejs> [output.html]
 *
 * Code blocks are highlighted at build time with highlight.js, and the Nord
 * stylesheet is inlined, so the output needs no network access and no runtime JS.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, extname } from 'node:path';
import ejs from 'ejs';
import { Marked } from 'marked';
import hljs from 'highlight.js';

const require = createRequire(import.meta.url);

const THEME = 'nord';
const USAGE = 'usage: node render.js <input.md> <template.ejs> [output.html]';

/** Highlight one code block, falling back to auto-detection for unlabelled fences. */
const highlight = (code, lang) =>
  lang && hljs.getLanguage(lang)
    ? hljs.highlight(code, { language: lang }).value
    : hljs.highlightAuto(code).value;

const marked = new Marked({
  renderer: {
    code(codeOrToken, infostring) {
      // marked >= 13 passes a token object; older versions pass positional args.
      const { text, lang } =
        typeof codeOrToken === 'object' ? codeOrToken : { text: codeOrToken, lang: infostring };
      const language = (lang ?? '').trim().split(/\s+/)[0];
      const className = language ? ` language-${language}` : '';
      return `<pre><code class="hljs${className}">${highlight(text, language)}</code></pre>\n`;
    },
  },
});

/** Page title: the first level-1 heading, or the input filename. */
const extractTitle = (markdown, fallback) =>
  marked.lexer(markdown).find((token) => token.type === 'heading' && token.depth === 1)?.text ??
  fallback;

async function main([input, templatePath, output]) {
  if (!input || !templatePath) throw new Error(USAGE);

  const [markdown, template, themeCss] = await Promise.all([
    readFile(input, 'utf8'),
    readFile(templatePath, 'utf8'),
    readFile(require.resolve(`highlight.js/styles/${THEME}.css`), 'utf8'),
  ]);

  const page = ejs.render(
    template,
    {
      title: extractTitle(markdown, basename(input, extname(input))),
      content: await marked.parse(markdown),
      themeCss,
    },
    { filename: templatePath }, // lets the template use <%- include(...) %>
  );

  const target = output ?? input.replace(/\.md$/i, '.html');
  await writeFile(target, page);
  console.log(`${input} -> ${target}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
