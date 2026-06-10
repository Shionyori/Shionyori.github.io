"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStringHelpers = registerStringHelpers;
function decodeEntities(html) {
    return html
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}
function cleanText(html) {
    return decodeEntities(html.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
}
function registerStringHelpers(hexo) {
    hexo.extend.helper.register('excerpt', function (content, length) {
        const maxLen = length || this.theme.home?.excerpt_length || 280;
        // Extract first <p> from rendered HTML, or fall back to full content
        const pMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const text = cleanText(pMatch ? pMatch[1] : content);
        if (text.length <= maxLen)
            return text;
        return text.substring(0, maxLen) + '...';
    });
    hexo.extend.helper.register('word_count', function (content) {
        const text = cleanText(content);
        const cn = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
        const en = (text.match(/[a-zA-Z0-9]+/g) || []).length;
        const total = cn + en;
        return total + ' ' + (total === 1 ? 'word' : 'words');
    });
    hexo.extend.helper.register('reading_time', function (content) {
        const text = cleanText(content);
        const cn = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
        const en = (text.match(/[a-zA-Z0-9]+/g) || []).length;
        const minutes = Math.max(1, Math.ceil(cn / 300 + en / 200));
        return minutes + ' min read';
    });
    hexo.extend.helper.register('strip_html', function (html) {
        return cleanText(html);
    });
}
