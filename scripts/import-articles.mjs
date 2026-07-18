import fs from 'fs';
import path from 'path';

const API_BASE = process.env.BLOG_API || 'http://127.0.0.1:3001';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function downloadImage(urlPath, dest) {
  const res = await fetch(`${API_BASE}${urlPath}`);
  if (!res.ok) throw new Error(`Failed to download ${urlPath}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

function escText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escCell(s) {
  return escText(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function blocksToMarkdown(blocks, imageMap) {
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
          const src = imageMap.get(block.src) || block.src;
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

async function prepareImages(article) {
  const slug = article.slug;
  const imageDir = path.join('assets', 'images', 'posts', slug);
  const imageUrlPrefix = `/assets/images/posts/${slug}`;
  const imageMap = new Map();
  const coverBasename = article.cover ? path.basename(article.cover) : null;

  if (article.cover?.startsWith('/uploads/')) {
    const ext = path.extname(article.cover) || '.jpg';
    const localName = `cover${ext}`;
    const localPath = path.join(imageDir, localName);
    await downloadImage(article.cover, localPath);
    imageMap.set(article.cover, `${imageUrlPrefix}/${localName}`);
  }

  for (const block of article.content) {
    if (block.type !== 'image' || !block.src.startsWith('/uploads/')) continue;

    const basename = path.basename(block.src);
    const localName =
      basename === coverBasename
        ? `cover${path.extname(block.src)}`
        : basename;

    if (imageMap.has(block.src)) continue;

    const localPath = path.join(imageDir, localName);
    await downloadImage(block.src, localPath);
    imageMap.set(block.src, `${imageUrlPrefix}/${localName}`);
  }

  const coverImage =
    (article.cover && imageMap.get(article.cover)) ||
    `${imageUrlPrefix}/cover${path.extname(article.cover || '.jpg')}`;

  return { imageMap, coverImage };
}

function writePost(article, imageMap, coverImage) {
  const slug = article.slug;
  const frontMatter = `---
layout: post
title: "${article.title.replace(/"/g, '\\"')}"
date: ${article.date} 12:00:00 +0300
categories: ${article.category}
author: ${article.author}
description: "${article.description.replace(/"/g, '\\"')}"
image: ${coverImage}
---

`;

  const md = frontMatter + blocksToMarkdown(article.content, imageMap);
  const outPath = path.join('_posts', `${article.date}-${slug}.md`);
  fs.writeFileSync(outPath, md, 'utf8');
  return { outPath, length: md.length };
}

async function importArticle(summary) {
  const article = await fetchJson(`${API_BASE}/api/articles/${summary.id}`);
  const { imageMap, coverImage } = await prepareImages(article);
  const { outPath, length } = writePost(article, imageMap, coverImage);
  console.log(`Imported: ${outPath} (${length} chars)`);
}

const summaries = await fetchJson(`${API_BASE}/api/articles`);
for (const summary of summaries) {
  await importArticle(summary);
}

console.log(`Done. Imported ${summaries.length} articles.`);
