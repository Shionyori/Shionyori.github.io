"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLinkCardTag = registerLinkCardTag;
function registerLinkCardTag(hexo) {
    hexo.extend.tag.register('linkCard', function (args, _content) {
        const title = args[0] || 'Link';
        const url = args[1] || '#';
        const desc = args[2] || '';
        return `
    <a class="tag-link-card" href="${url}" target="_blank" rel="noopener">
      <span class="link-card-title">${title}</span>
      ${desc ? `<span class="link-card-desc">${desc}</span>` : ''}
      <span class="link-card-url">${url}</span>
    </a>`;
    });
}
