"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerContentFilters = registerContentFilters;
function registerContentFilters(hexo) {
    const config = hexo.theme.config || {};
    hexo.extend.filter.register('after_post_render', function (data) {
        if (!data.content)
            return data;
        // Lazy load images
        if (config?.post?.image?.lazy_load) {
            data.content = data.content.replace(/<img(?!.*?loading=)/g, '<img loading="lazy"');
        }
        // Lightbox: wrap images in links for medium-zoom grouping
        if (config?.post?.image?.lightbox) {
            data.content = data.content.replace(/<img(?: (?!loading=)[^>]*)? src="([^"]+)"(?: (?!loading=)[^>]*)?(?: alt="([^"]*)")?[^>]*>/g, (match, src, alt) => {
                if (match.includes('data-lightbox'))
                    return match;
                const caption = alt || '';
                return `<a href="${src}" data-lightbox="post" data-caption="${caption}">${match}</a>`;
            });
        }
        // External links target="_blank"
        data.content = data.content.replace(/<a href="(https?:\/\/[^"]+)"(?!.*?target=)/g, '<a href="$1" target="_blank" rel="noopener"');
        return data;
    });
}
