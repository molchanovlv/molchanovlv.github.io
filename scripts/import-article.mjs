import fs from 'fs';
import path from 'path';

const article = JSON.parse(fs.readFileSync('article.json', 'utf8'));
const slug = article.slug;
const imageDir = `assets/images/posts/${slug}`;
const imageUrlPrefix = `/${imageDir}`;

function escText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escCell(s) {
  return escText(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function resolveImageSrc(src) {
  if (src.startsWith('/uploads/')) {
    const filename = path.basename(src);
    const localName =
      filename === path.basename(article.cover || '')
        ? 'cover' + path.extname(filename)
        : filename.includes('s7f7t8') || src.includes('derby')
          ? 'derby_settings' + path.extname(filename)
          : filename;
    return `${imageUrlPrefix}/${localName}`;
  }
  if (src.includes('derby_settings') || src.includes('derby-cache')) {
    const ext = path.extname(src) || '.png';
    return `${imageUrlPrefix}/derby_settings${ext}`;
  }
  return src;
}

function blocksToMarkdown(blocks) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
          return `${escText(block.text)}\n`;
        case 'heading':
          return `${'#'.repeat(block.level)} ${block.text}\n`;
        case 'list':
          return `${block.items
            .map((item, i) => `${block.ordered ? `${i + 1}. ` : '- '}${escText(item)}`)
            .join('\n')}\n`;
        case 'code':
          return `\`\`\`${block.language}\n${block.text}\n\`\`\`\n`;
        case 'quote':
          return `> ${escText(block.text)}\n`;
        case 'image': {
          const src = resolveImageSrc(block.src);
          let md = `![${block.alt || ''}](${src})\n`;
          if (block.caption) md += `*${block.caption}*\n`;
          return md;
        }
        case 'table': {
          const header = `| ${block.headers.map(escCell).join(' | ')} |`;
          const sep = `| ${block.headers.map(() => '---').join(' | ')} |`;
          const rows = block.rows.map((r) => `| ${r.map(escCell).join(' | ')} |`).join('\n');
          return `${header}\n${sep}\n${rows}\n`;
        }
        default:
          return '';
      }
    })
    .join('\n');
}

const coverExt = path.extname(article.cover || '.jpg') || '.jpg';
const frontMatter = `---
layout: post
title: "${article.title.replace(/"/g, '\\"')}"
date: ${article.date} 12:00:00 +0300
categories: ${article.category}
author: ${article.author}
description: "${article.description.replace(/"/g, '\\"')}"
image: ${imageUrlPrefix}/cover${coverExt}
---

`;

const md = frontMatter + blocksToMarkdown(article.content);
const outPath = `_posts/${article.date}-${slug}.md`;
fs.writeFileSync(outPath, md, 'utf8');
console.log(`Written ${outPath} (${md.length} chars)`);
