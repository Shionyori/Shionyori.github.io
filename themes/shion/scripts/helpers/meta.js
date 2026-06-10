"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMetaHelpers = registerMetaHelpers;
function registerMetaHelpers(hexo) {
    hexo.extend.helper.register('open_graph', function (page) {
        const config = this.config;
        const og = {
            'og:title': page.title || config.title,
            'og:type': page.layout === 'post' ? 'article' : 'website',
            'og:url': config.url + '/' + (page.path || ''),
            'og:site_name': config.title,
        };
        return Object.entries(og)
            .map(([k, v]) => `<meta property="${k}" content="${escapeAttr(v)}">`)
            .join('\n');
    });
    hexo.extend.helper.register('twitter_card', function (page) {
        return [
            '<meta name="twitter:card" content="summary">',
            `<meta name="twitter:title" content="${escapeAttr((page.title || this.config.title))}">`,
        ].join('\n');
    });
    hexo.extend.helper.register('structured_data', function (_page) {
        const config = this.config;
        const json = {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: config.title,
            url: config.url,
        };
        return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
    });
    hexo.extend.helper.register('canonical_url', function (page) {
        return this.config.url + '/' + (page.path || '');
    });
}
function escapeAttr(value) {
    return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
