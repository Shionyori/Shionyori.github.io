"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register404Generator = register404Generator;
function register404Generator(hexo) {
    hexo.extend.generator.register('404', function () {
        return {
            path: '404.html',
            layout: ['404'],
            data: {
                title: '404',
                type: '404',
            },
        };
    });
}
