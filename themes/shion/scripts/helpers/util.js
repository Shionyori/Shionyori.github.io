"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUtilHelpers = registerUtilHelpers;
function registerUtilHelpers(hexo) {
    hexo.extend.helper.register('is_current', function (path, currentPath) {
        const current = currentPath || this.page?.path || '';
        if (path === '/')
            return current === 'index.html' || current === '';
        return current.startsWith(path.replace(/\/$/, ''));
    });
    hexo.extend.helper.register('shion_image', function (name) {
        const config = this.theme.shion || {};
        return config[name + '_image'] || '/images/shion/' + name + '.png';
    });
}
