define([
    'providers/html5',
    'providers/flash',
    'polyfills/vtt',
    'intersection-observer'
], function (providerHtml5, providerFlash, vtt, intersectionObserver) {
    __webpack_require__.e = function (array, callback) {
        callback(function webpackRequire(modulePath) {
            return ({
                'providers/html5': providerHtml5,
                'providers/flash': providerFlash,
                'polyfills/vtt': vtt,
                'intersection-observer': intersectionObserver
            })[modulePath];
        });
    };
});