"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDetailsTag = registerDetailsTag;
function registerDetailsTag(hexo) {
    hexo.extend.tag.register('details', function (args, content) {
        const summary = args[0] || 'Details';
        return `<details class="tag-details"><summary>${summary}</summary>${content}</details>`;
    }, { ends: true });
}
