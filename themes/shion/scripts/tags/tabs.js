"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTabsTag = registerTabsTag;
function registerTabsTag(hexo) {
    hexo.extend.tag.register('tabs', function (args, content) {
        const activeIndex = parseInt(args[0], 10) || 0;
        const blocks = content.split(/<!--\s*tab\s*-->/).filter(Boolean);
        if (blocks.length === 0)
            return '';
        let html = '<div class="tabs">';
        // Tab headers
        html += '<div class="tabs-header">';
        blocks.forEach((block, i) => {
            const match = block.match(/^<!--\s*"([^"]+)"\s*-->/);
            const label = match ? match[1] : 'Tab ' + (i + 1);
            html += `<button class="tab-btn${i === activeIndex ? ' active' : ''}" data-tab="${i}">${label}</button>`;
        });
        html += '</div>';
        // Tab content
        html += '<div class="tabs-content">';
        blocks.forEach((block, i) => {
            const cleaned = block.replace(/^<!--\s*"[^"]+"\s*-->/, '').trim();
            html += `<div class="tab-panel${i === activeIndex ? ' active' : ''}" data-tab="${i}">${cleaned}</div>`;
        });
        html += '</div></div>';
        return html;
    }, { ends: true });
}
