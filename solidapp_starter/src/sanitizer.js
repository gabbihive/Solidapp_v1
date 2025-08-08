import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
export function renderMarkdown(md){
  const raw = marked.parse(md||'');
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img','h1','h2','h3','blockquote','pre','code']),
    allowedAttributes: { a:['href','name','target','rel'], img:['src','alt'] },
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel:'nofollow noopener noreferrer', target:'_blank' }) }
  });
}
