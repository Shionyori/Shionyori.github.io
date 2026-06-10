"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDateHelpers = registerDateHelpers;
function registerDateHelpers(hexo) {
    hexo.extend.helper.register('format_date', function (date, format) {
        const moment = hexo.extend.helper.get('date');
        const fmt = format || this.theme.post?.date_format || 'YYYY-MM-DD';
        return moment(date, fmt);
    });
}
