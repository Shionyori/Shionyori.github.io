"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerQuoteTag = registerQuoteTag;
function registerQuoteTag(hexo) {
    hexo.extend.tag.register('blockquote', function (args, content) {
        const author = args[0] || '';
        const source = args[1] || '';
        let html = `<blockquote class="styled-blockquote">`;
        html += content;
        if (author) {
            html += `<footer class="blockquote-footer">&mdash; ${author}`;
            if (source) {
                html += `, <cite>${source}</cite>`;
            }
            html += `</footer>`;
        }
        html += `</blockquote>`;
        return html;
    }, { ends: true });
}
