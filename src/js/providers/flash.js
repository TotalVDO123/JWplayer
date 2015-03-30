define([
    'utils/helpers',
    'underscore',
    'events/events',
    'events/states',
    'utils/eventdispatcher',
    'utils/embedswf',
    'providers/default'
], function(utils, _, events, states, eventdispatcher, EmbedSwf, DefaultProvider) {


    var _providerId = 0;
    function getObjectId(playerId) {
        return playerId + '_swf_' + (_providerId++);
    }

    function FlashProvider(_playerId) {

        // private properties
        var _container;
        var _swf;
        var _clickOverlay;
        var _item = null;
        var _volume;
        var _muted = false;
        var _beforecompleted = false;
        var _currentQuality = -1;
        var _flashProviderType;

        var _ready = function() {
            return _swf && _swf.__ready;
        };

        var _queuedCommands = [];

        var _flashCommand = function(name) {
            var args = Array.prototype.slice.call(arguments);
            if (_ready()) {
                _swf.triggerFlash.apply(_swf, args);
                return;
            }
            // remove any earlier commands with the same name
            for (var i = _queuedCommands.length; i--;) {
                if (_queuedCommands[i][0] === name) {
                    _queuedCommands.splice(i, 1);
                }
            }
            _queuedCommands.push(args);
        };

        var _eventDispatcher = new eventdispatcher('flash.provider');

        _.extend(this, _eventDispatcher, {
                load: function(item) {
                    _item = item;
                    this.setState(states.LOADING);
                    _flashCommand('load', item);
                },
                play: function() {
                    _flashCommand('play');
                },
                pause: function() {
                    _flashCommand('pause');
                    this.setState(states.PAUSED);
                },
                stop: function() {
                    _flashCommand('stop');
                    _currentQuality = -1;
                    _item = null;
                    this.setState(states.IDLE);
                },
                seek: function(seekPos) {
                    /*
                     this.sendEvent(events.JWPLAYER_MEDIA_SEEK, {
                         position: _position,
                         offset: seekPos
                     });
                     */
                    _flashCommand('seek', seekPos);
                },
                volume: function(vol) {
                    if (utils.exists(vol)) {
                        _volume = Math.min(Math.max(0, vol), 100);
                        _flashCommand('volume', _volume);
                    }
                },
                mute: function(muted) {
                    _muted = utils.exists(muted) ? muted : !_muted;
                    _flashCommand('mute', muted);
                },
                setState: function() {
                    return DefaultProvider.setState.apply(this, arguments);
                },
                checkComplete: function() {
                    return _beforecompleted;
                },
                attachMedia: function() {
                    // This is after a postroll completes
                    if (_beforecompleted) {
                        this.setState(states.IDLE);
                        this.sendEvent(events.JWPLAYER_MEDIA_COMPLETE);
                        _beforecompleted = false;
                    }
                },
                detachMedia: function() {
                    return null;
                },
                getContainer: function() {
                    return _container;
                },
                setContainer: function(parent) {
                    _container = parent;

                    _swf = _swf || EmbedSwf.embed('../bin-debug/jwplayer.flash.swf', parent, getObjectId(_playerId));

                    // place div on top of swf to capture clicks
                    if (!_clickOverlay) {
                        _clickOverlay = document.createElement('div');
                        _clickOverlay.style.background = 'transparent';
                        _clickOverlay.style.position = 'absolute';
                        _clickOverlay.style.left = 0;
                        _clickOverlay.style.right = 0;
                        _clickOverlay.style.top = 0;
                        _clickOverlay.style.bottom = 0;
                        _clickOverlay.addEventListener('click', function() {
                            _eventDispatcher.sendEvent(events.JWPLAYER_PROVIDER_CLICK);
                        });
                    }
                    _container.appendChild(_clickOverlay);


                    // listen to events triggered from flash

                    _swf.off();

                    _swf.once('ready', function() {
                        _swf.__ready = true;

                        // setup flash player
                        var config = _.extend({
                            key: jwplayer.key,
                            commands: _queuedCommands
                        }, jwplayer(_playerId).config);

                        _queuedCommands = [];

                        _flashCommand('setup', config);

                    }, this);

                    _swf.on('error', function(event) {
                        console.error(event.code, event.message, event, this);
                        this.sendEvent(events.JWPLAYER_MEDIA_ERROR, {
                            message: 'Error loading media: File could not be played'
                        });
                        this.setState(states.IDLE);
                    }, this);

                    // jwplayer 6 flash player events (forwarded from AS3 Player, Controller, Model)
                    _swf.on(events.JWPLAYER_MEDIA_LEVELS, function(e) {
                        this.sendEvent(e.type, {
                            levels: e.levels,
                            currentQuality: e.currentQuality
                        });

                    }, this).on(events.JWPLAYER_PLAYER_STATE, function(e) {
                        if (e.newstate === states.IDLE) {
                            return;
                        }
                        var state = e.newstate;
                        this.setState(state);

                    }, this).on(events.JWPLAYER_MEDIA_META, function(e) {
                        // width and height are not always sent with duration
                        var metadata = e.metadata;
                        if (metadata && metadata.duration > 0) {
                            if (!metadata.width || !metadata.height) {
                                // FIXME: HTML5 player needs these three properties in the first meta event
                                console.error('invalid html5 meta event');
                            }
                            this.sendEvent(e.type, {
                                duration: metadata.duration,
                                height:   metadata.height,
                                width:    metadata.width
                            });
                        }
                        // TODO: html5 player doesn't know what to do with custom metadata
                        // else this.sendEvent(e.type, e.metadata);

                    }, this).on(events.JWPLAYER_MEDIA_BUFFER_FULL, function(e) {
                        this.sendEvent(e.type);

                    }, this).on(events.JWPLAYER_MEDIA_BUFFER, function(e) {
                        this.sendEvent(e.type, {
                            bufferPercent: e.bufferPercent
                        });

                    }, this).on(events.JWPLAYER_MEDIA_TIME, function(e) {
                        this.sendEvent(e.type, {
                            position: e.position,
                            duration: e.duration
                        });

                    }, this)
                    .on(events.JWPLAYER_MEDIA_BEFORECOMPLETE, function(e) {
                        this.sendEvent(e.type);
                    }, this).on(events.JWPLAYER_MEDIA_COMPLETE, function(e) {
                        this.setState(states.IDLE);
                        this.sendEvent(e.type);
                    }, this).on(events.JWPLAYER_MEDIA_ERROR, function(e) {
                        this.sendEvent(e.type, e);
                    }, this);

                    _swf.on(events.JWPLAYER_MEDIA_MUTE, function(data) {
                        this.sendEvent(events.JWPLAYER_MEDIA_MUTE, {
                            mute: data.mute
                        });
                    }, this);

                    _swf.on(events.JWPLAYER_MEDIA_VOLUME, function(data) {
                        this.sendEvent(events.JWPLAYER_MEDIA_VOLUME, {
                            volume: data.volume
                        });
                    }, this);

                    _swf.on(events.JWPLAYER_PROVIDER_CHANGED, function(data) {
                        _flashProviderType = data.message;
                    }, this);

                    // ignoring:
                    // jwplayerMediaLoaded, jwplayerMediaBeforePlay, ...

                    // catch all events for dev / debug
                    _swf.on('all', function(name, data) {
                        switch (name) {
                            case 'ready':
                            case events.JWPLAYER_MEDIA_TIME:
                            case events.JWPLAYER_MEDIA_BUFFER:
                                break;
                            case events.JWPLAYER_MEDIA_BEFOREPLAY:
                            case events.JWPLAYER_MEDIA_LOADED:
                            case events.JWPLAYER_MEDIA_BUFFER_FULL:
                            case events.JWPLAYER_MEDIA_BEFORECOMPLETE:
                            case events.JWPLAYER_MEDIA_COMPLETE:
                                console.log(name);
                                break;
                            case events.JWPLAYER_MEDIA_META:
                                // duration, size, stage video or something else...
                                console.log(name);
                                break;
                            case events.JWPLAYER_MEDIA_LEVELS:
                                console.log(name, data.currentQuality, data.levels);
                                break;
                            case events.JWPLAYER_PLAYER_STATE:
                                console.log(name, data.newstate);
                                break;
                            case events.JWPLAYER_MEDIA_SEEK:
                                console.log(name, data.offset);
                                break;
                            case 'resize':
                                console.log(name, data.width, data.height, data.fullscreen);
                                break;
                            default:
                                console.log(name, data);
                        }
                    }, this);
                },
                remove: function() {
                    _currentQuality = -1;
                    EmbedSwf.remove(_swf);
                    if (_clickOverlay && _container && _clickOverlay.parentNode === _container) {
                        _container.removeChild(_clickOverlay);
                    }
                },
                setVisibility: function(visible) {
                    visible = !!visible;
                    _container.style.visibility = visible ? 'visible':'hidden';
                    _container.style.opacity = visible ? 1:0;
                },
                resize: function(width, height, stretching) {
                    _flashCommand('stretch', stretching);
                },
                setControls: function() {

                },
                setFullScreen: function() {

                },
                getFullScreen: function() {
                    return false;
                },
                isAudioFile: function() {
                    // TODO: controller could do this
                    if (_item) {
                        var type = _item.sources[0].type;
                        return (type === 'oga' || type === 'aac' || type === 'mp3' || type === 'vorbis');
                    }
                    return false;
                },
                setCurrentQuality: function(/* quality */) {
                    // TODO: setCurrentQuality
                },
                getCurrentQuality: function() {
                    return _currentQuality;
                },
                getProvider: function() {
                    if(_flashProviderType){
                        var returnObj = { name : 'flash_' + _flashProviderType };

                        return returnObj;
                    }
                    return { name : 'flash' };
                },
                getQualityLevels: function() {
                    // TODO: _getPublicLevels
                    return _item.sources;
                },
                supportsFullscreen: _.constant(true),
                destroy: function() {
                    this.remove();
                    if (_swf) {
                        _swf.off();
                        _swf = null;
                    }
                    _clickOverlay = null;
                    _container = null;
                    _item = null;
                    _eventDispatcher.resetEventListeners();
                    _eventDispatcher = null;
                }
        });
    }


    var flashExtensions = {
        'flv': 'video',
        'f4v': 'video',
        'mov': 'video',
        'm4a': 'video',
        'm4v': 'video',
        'mp4': 'video',
        'aac': 'video',
        'f4a': 'video',
        'mp3': 'sound',
        'smil': 'rtmp',
        'm3u8': 'hls',
        'hls': 'hls'
    };
    var PLAYABLE = _.keys(flashExtensions);

    // Register provider
    var F = function(){};
    F.prototype = DefaultProvider;
    FlashProvider.prototype = new F();
    FlashProvider.supports = function (source) {
        var flashVersion = utils.flashVersion();
        if (!flashVersion || flashVersion < __FLASH_VERSION__) {
            return false;
        }

        var file = source.file;
        var type = source.type;

        if (type === 'hls') {
            return true;
        }
        if (utils.isRtmp(file, type)) {
            return true;
        }
        if (utils.isYouTube(file, type)) {
            return true;
        }

        return _.contains(PLAYABLE, type);
    };

    return FlashProvider;
});
