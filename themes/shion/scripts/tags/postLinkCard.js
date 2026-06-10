"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPostLinkCardTag = registerPostLinkCardTag;
function registerPostLinkCardTag(hexo) {
    hexo.extend.tag.register('postLinkCard', function (args, _content) {
        const slug = args[0];
        if (!slug)
            return '';
        const posts = hexo.locals.get('posts');
        if (!posts || !posts.data)
            return '';
        const post = posts.data.find((p) => p.slug === slug || p.path?.includes(slug));
        if (!post)
            return `<p>Post not found: ${slug}</p>`;
        const title = post.title;
        const excerpt = (post.excerpt || '')
            .replace(/<[^>]*>/g, '')
            .trim()
            .substring(0, 150);
        const url = hexo.config.url + '/' + post.path;
        return `
    <a class="tag-link-card tag-post-card" href="${url}">
      <span class="link-card-title">${title}</span>
      ${excerpt ? `<span class="link-card-desc">${excerpt}</span>` : ''}
      <span class="link-card-url">${url}</span>
    </a>`;
    });
}
