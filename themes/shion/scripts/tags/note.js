"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerNoteTag = registerNoteTag;
function registerNoteTag(hexo) {
    hexo.extend.tag.register('note', function (args, content) {
        const type = args[0] || 'info';
        const validTypes = ['info', 'warning', 'success', 'danger'];
        const noteType = validTypes.includes(type) ? type : 'info';
        return `<div class="note note-${noteType}">${content}</div>`;
    }, { ends: true });
}
