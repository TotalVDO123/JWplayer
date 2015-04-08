define([
    'events/events',
    'utils/backbone.events',
    'underscore'
], function(events, Events, _) {

    var _loaders = {};

    var scriptloader = function (url) {
        var _this = _.extend(this, Events),
            _status = _loaderstatus.NEW;

        // legacy support
        this.addEventListener = this.on;
        this.removeEventListener = this.off;

        this.load = function () {
            // Only execute on the first run
            if (_status !== _loaderstatus.NEW) {
                return;
            }

            // If we already have a scriptloader loading the same script, don't create a new one;
            var sameLoader = _loaders[url];
            if (sameLoader) {
                _status = sameLoader.getStatus();
                if (_status < 2) {
                    // dispatch to this instances listeners when the first loader gets updates
                    sameLoader.on(events.ERROR, _sendError);
                    sameLoader.on(events.COMPLETE, _sendComplete);
                    return;
                }
                // already errored or loaded... keep going?
            }

            var head = document.getElementsByTagName('head')[0] || document.documentElement;
            var scriptTag = document.createElement('script');

            var done = false;
            scriptTag.onload = scriptTag.onreadystatechange = function (evt) {
                if (!done &&
                    (!this.readyState || this.readyState === 'loaded' || this.readyState === 'complete')) {
                    done = true;
                    _sendComplete(evt);

                    // Handle memory leak in IE
                    scriptTag.onload = scriptTag.onreadystatechange = null;
                    if (head && scriptTag.parentNode) {
                        head.removeChild(scriptTag);
                    }
                }
            };
            scriptTag.onerror = _sendError;

            scriptTag.src = url;
            head.insertBefore(scriptTag, head.firstChild);

            _status = _loaderstatus.LOADING;
            _loaders[url] = this;
        };

        function _sendError(evt) {
            _status = _loaderstatus.ERROR;
            _this.trigger(events.ERROR, evt);
        }

        function _sendComplete(evt) {
            _status = _loaderstatus.COMPLETE;
            _this.trigger(events.COMPLETE, evt);
        }


        this.getStatus = function () {
            return _status;
        };
    };

    var _loaderstatus = scriptloader.loaderstatus = {
        NEW: 0,
        LOADING: 1,
        ERROR: 2,
        COMPLETE: 3
    };

    return scriptloader;
});
