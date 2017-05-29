define([
    'utils/helpers',
    'providers/providers',
    'controller/qoe',
    'utils/underscore',
    'utils/backbone.events',
    'utils/simplemodel',
    'events/events',
    'events/states'
], function(utils, Providers, QOE, _, Events, SimpleModel, events, states) {

    // Represents the state of the player
    var Model = function() {
        var _this = this;
        var _providers;
        var _provider;
        var _beforecompleted = false;
        var _attached = true;

        this.mediaController = _.extend({}, Events);
        this.mediaModel = new MediaModel();

        QOE.model(this);

        this.set('mediaModel', this.mediaModel);

        this.setup = function(config) {

            _.extend(this.attributes, config, {
                // always start on first playlist item
                item: 0,
                itemMeta: {},
                defaultPlaybackRate: 1,
                playbackRate: 1,
                playlistItem: undefined,
                // Initial state, upon setup
                state: states.IDLE,
                // Initially we don't assume Flash is needed
                flashBlocked: false,
                provider: undefined,
                duration: 0,
                position: 0,
                buffer: 0
            });

            this.updateProviders();

            return this;
        };

        this.getConfiguration = function() {
            return _.omit(this.clone(), ['mediaModel']);
        };

        this.updateProviders = function() {
            _providers = new Providers(this.getConfiguration());
        };

        function _videoEventHandler(type, data) {
            var evt = _.extend({}, data, { type: type });
            var mediaModel = this.mediaModel;
            switch (type) {
                case 'flashThrottle':
                    var throttled = (data.state !== 'resume');
                    this.set('flashThrottle', throttled);
                    this.set('flashBlocked', throttled);
                    break;
                case 'flashBlocked':
                    this.set('flashBlocked', true);
                    return;
                case 'flashUnblocked':
                    this.set('flashBlocked', false);
                    return;
                case 'volume':
                    this.set(type, data[type]);
                    return;
                case 'mute':
                    if (!this.get('autostartMuted')) {
                        // Don't persist mute state with muted autostart
                        this.set(type, data[type]);
                    }
                    return;
                case 'ratechange':
                    this.set('playbackRate', data.playbackRate);
                    return;
                case events.JWPLAYER_MEDIA_TYPE:
                    if (mediaModel.get('mediaType') !== data.mediaType) {
                        mediaModel.set('mediaType', data.mediaType);
                        this.mediaController.trigger(type, evt);
                    }
                    return;
                case events.JWPLAYER_PLAYER_STATE:
                    mediaModel.set('state', data.newstate);

                    // This "return" is important because
                    //  we are choosing to not propagate this event.
                    //  Instead letting the master controller do so
                    return;
                case events.JWPLAYER_MEDIA_BUFFER:
                    this.set('buffer', data.bufferPercent);
                /* falls through */
                case events.JWPLAYER_MEDIA_META:
                    var duration = data.duration;
                    if (_.isNumber(duration) && !_.isNaN(duration)) {
                        mediaModel.set('duration', duration);
                        this.set('duration', duration);
                    }
                    break;
                case events.JWPLAYER_MEDIA_BUFFER_FULL:
                    // media controller
                    if (mediaModel.get('playAttempt')) {
                        this.playVideo();
                    } else {
                        mediaModel.on('change:playAttempt', function() {
                            this.playVideo();
                        }, this);
                    }
                    this.setPlaybackRate(this.get('defaultPlaybackRate'));
                    break;
                case events.JWPLAYER_MEDIA_TIME:
                    mediaModel.set('position', data.position);
                    this.set('position', data.position);
                    if (_.isNumber(data.duration)) {
                        mediaModel.set('duration', data.duration);
                        this.set('duration', data.duration);
                    }
                    break;
                case events.JWPLAYER_PROVIDER_CHANGED:
                    this.set('provider', _provider.getName());
                    break;
                case events.JWPLAYER_MEDIA_LEVELS:
                    this.setQualityLevel(data.currentQuality, data.levels);
                    mediaModel.set('levels', data.levels);
                    break;
                case events.JWPLAYER_MEDIA_LEVEL_CHANGED:
                    this.setQualityLevel(data.currentQuality, data.levels);
                    this.persistQualityLevel(data.currentQuality, data.levels);
                    break;
                case events.JWPLAYER_MEDIA_COMPLETE:
                    _beforecompleted = true;
                    this.mediaController.trigger(events.JWPLAYER_MEDIA_BEFORECOMPLETE, evt);
                    if (_attached && mediaModel.get('state') !== states.COMPLETE &&
                        mediaModel.get('state') !== states.IDLE) {
                        this.playbackComplete();
                    }
                    return;
                case events.JWPLAYER_AUDIO_TRACKS:
                    this.setCurrentAudioTrack(data.currentTrack, data.tracks);
                    mediaModel.set('audioTracks', data.tracks);
                    break;
                case events.JWPLAYER_AUDIO_TRACK_CHANGED:
                    this.setCurrentAudioTrack(data.currentTrack, data.tracks);
                    break;
                case 'subtitlesTrackChanged':
                    this.persistVideoSubtitleTrack(data.currentTrack, data.tracks);
                    break;
                case 'visualQuality':
                    var visualQuality = _.extend({}, data);
                    mediaModel.set('visualQuality', visualQuality);
                    break;
                case 'autoplayFailed':
                    this.set('autostartFailed', true);
                    if (mediaModel.get('state') === states.PLAYING) {
                        mediaModel.set('state', states.PAUSED);
                    }
                    break;
                default:
                    break;
            }

            this.mediaController.trigger(type, evt);
        }

        this.setQualityLevel = function(quality, levels) {
            if (quality > -1 && levels.length > 1 && _provider.getName().name !== 'youtube') {
                this.mediaModel.set('currentLevel', parseInt(quality));

            }
        };

        this.persistQualityLevel = function(quality, levels) {
            var currentLevel = levels[quality] || {};
            var label = currentLevel.label;
            this.set('qualityLabel', label);
        };

        this.setCurrentAudioTrack = function(currentTrack, tracks) {
            if (currentTrack > -1 && tracks.length > 0 && currentTrack < tracks.length) {
                this.mediaModel.set('currentAudioTrack', parseInt(currentTrack));
            }
        };

        this.onMediaContainer = function() {
            var container = this.get('mediaContainer');
            _provider.setContainer(container);
        };

        this.changeVideoProvider = function(Provider) {
            this.off('change:mediaContainer', this.onMediaContainer);

            if (_provider) {
                _provider.off(null, null, this);
                if (_provider.getContainer()) {
                    _provider.remove();
                }
                delete _provider.instreamMode;
            }

            if (!Provider) {
                this.resetProvider();
                this.set('provider', undefined);
                return;
            }

            _provider = new Provider(_this.get('id'), _this.getConfiguration());

            var container = this.get('mediaContainer');
            if (container) {
                _provider.setContainer(container);
            } else {
                this.once('change:mediaContainer', this.onMediaContainer);
            }

            this.set('provider', _provider.getName());

            if (_provider.getName().name.indexOf('flash') === -1) {
                this.set('flashThrottle', undefined);
                this.set('flashBlocked', false);
            }

            _provider.volume(_this.get('volume'));

            // Mute the video if autostarting on mobile. Otherwise, honor the model's mute value
            _provider.mute(this.autoStartOnMobile() || _this.get('mute'));

            // Attempt setting the playback rate to be the user selected value
            this.setPlaybackRate(this.get('defaultPlaybackRate'));

            _provider.on('all', _videoEventHandler, this);

            if (this.get('instreamMode') === true) {
                _provider.instreamMode = true;
            }

            this.set('renderCaptionsNatively', _provider.renderNatively);
        };

        this.checkComplete = function() {
            return _beforecompleted;
        };

        this.detachMedia = function() {
            _attached = false;
            _provider.off('all', _videoEventHandler, this);
            return _provider.detachMedia();
        };

        this.attachMedia = function() {
            _attached = true;
            _provider.off('all', _videoEventHandler, this);
            _provider.on('all', _videoEventHandler, this);
            if (_beforecompleted) {
                this.playbackComplete();
            }

            _provider.attachMedia();

            // Restore the playback rate to the provider in case it changed while detached and we reused a video tag.
            this.setPlaybackRate(this.get('defaultPlaybackRate'));
        };

        this.playbackComplete = function() {
            _beforecompleted = false;
            _provider.setState(states.COMPLETE);
            this.mediaController.trigger(events.JWPLAYER_MEDIA_COMPLETE, {});
        };

        this.destroy = function() {
            this.off();
            if (_provider) {
                _provider.off(null, null, this);
                _provider.destroy();
            }
        };

        this.getVideo = function() {
            return _provider;
        };

        this.setFullscreen = function(state) {
            state = !!state;
            if (state !== _this.get('fullscreen')) {
                _this.set('fullscreen', state);
            }
        };

        // Give the option for a provider to be forced
        this.chooseProvider = function(source) {
            // if _providers.choose is null, something went wrong in filtering
            return _providers.choose(source).provider;
        };

        this.setItemIndex = function(index) {
            var playlist = this.get('playlist');

            // If looping past the end, or before the beginning
            index = parseInt(index, 10) || 0;
            index = (index + playlist.length) % playlist.length;

            this.set('item', index);
            this.set('playlistItem', playlist[index]);
            this.setActiveItem(playlist[index]);
        };

        this.setActiveItem = function(item) {
            // Item is actually changing
            this.mediaModel.off();
            this.mediaModel = new MediaModel();
            this.set('itemMeta', {});
            this.set('mediaModel', this.mediaModel);
            this.set('position', item.starttime || 0);
            this.set('minDvrWindow', item.minDvrWindow);
            this.set('duration', (item.duration && utils.seconds(item.duration)) || 0);
            this.setProvider(item);
        };

        this.setProvider = function(item) {
            var source = item && item.sources && item.sources[0];
            if (source === undefined) {
                // source is undefined when resetting index with empty playlist
                return;
            }

            var provider = this.chooseProvider(source);
            // If we are changing video providers
            if (!provider || !(_provider instanceof provider)) {
                _this.changeVideoProvider(provider);
            }

            if (!_provider) {
                return;
            }

            // this allows the providers to preload
            if (_provider.init) {
                _provider.init(item);
            }

            // Listening for change:item won't suffice when loading the same index or file
            // We also can't listen for change:mediaModel because it triggers whether or not
            //  an item was actually loaded
            this.trigger('itemReady', item);
        };

        this.getProviders = function() {
            return _providers;
        };

        this.resetProvider = function() {
            _provider = null;
        };

        this.setVolume = function(volume) {
            volume = Math.round(volume);
            this.set('volume', volume);
            if (_provider) {
                _provider.volume(volume);
            }
            var mute = (volume === 0);
            if (mute !== (this.getMute())) {
                this.setMute(mute);
            }
        };

        this.getMute = function() {
            return this.get('autostartMuted') || this.get('mute');
        };

        this.setMute = function(mute) {
            if (!utils.exists(mute)) {
                mute = !(this.getMute());
            }
            this.set('mute', mute);
            if (_provider) {
                _provider.mute(mute);
            }
            if (!mute) {
                var volume = Math.max(10, this.get('volume'));
                this.set('autostartMuted', false);
                this.setVolume(volume);
            }
        };

        this.setStreamType = function(streamType) {
            this.set('streamType', streamType);
            if (streamType === 'LIVE') {
                this.setPlaybackRate(1);
            }
        };

        this.setPlaybackRate = function(playbackRate) {
            if (!_attached || !_.isNumber(playbackRate)) {
                return;
            }

            // Clamp the rate between 0.25x and 4x speed
            var clampedRate = Math.max(0.25, Math.min(playbackRate, 4));
            if (this.get('streamType') === 'LIVE') {
                clampedRate = 1;
            }

            this.set('defaultPlaybackRate', clampedRate);
            // Providers which support changes in playback rate will return the rate that we changed to
            if (_provider) {
                _provider.setPlaybackRate(clampedRate);
            }
        };

        // The model is also the mediaController for now
        this.loadVideo = function(item) {
            if (!item) {
                item = this.get('playlist')[this.get('item')];
            }
            this.set('position', item.starttime || 0);
            this.set('duration', (item.duration && utils.seconds(item.duration)) || 0);
            this.mediaModel.set('playAttempt', true);
            this.mediaController.trigger(events.JWPLAYER_MEDIA_PLAY_ATTEMPT, { playReason: this.get('playReason') });

            _provider.load(item);
        };

        this.stopVideo = function() {
            if (_provider) {
                _provider.stop();
            }
        };

        this.playVideo = function() {
            _provider.play();
        };

        this.persistCaptionsTrack = function() {
            var track = this.get('captionsTrack');

            if (track) {
                // update preference if an option was selected
                this.set('captionLabel', track.name);
            } else {
                this.set('captionLabel', 'Off');
            }
        };


        this.setVideoSubtitleTrack = function(trackIndex, tracks) {
            this.set('captionsIndex', trackIndex);
            /*
             * Tracks could have changed even if the index hasn't.
             * Need to ensure track has data for captionsrenderer.
             */
            if (trackIndex && tracks && trackIndex <= tracks.length && tracks[trackIndex - 1].data) {
                this.set('captionsTrack', tracks[trackIndex - 1]);
            }

            if (_provider && _provider.setSubtitlesTrack) {
                _provider.setSubtitlesTrack(trackIndex);
            }
        };

        this.persistVideoSubtitleTrack = function(trackIndex, tracks) {
            this.setVideoSubtitleTrack(trackIndex, tracks);
            this.persistCaptionsTrack();
        };

        function _autoStartSupportedIOS() {
            if (!utils.isIOS()) {
                return false;
            }
            // Autostart only supported in iOS 10 or higher - check if the version is 9 or less
            return !(utils.isIOS(6) || utils.isIOS(7) || utils.isIOS(8) || utils.isIOS(9));
        }

        function platformCanAutostart() {
            var autostartAdsIsEnabled = (!_this.get('advertising') || _this.get('advertising').autoplayadsmuted);
            var iosBrowserIsSupported = _autoStartSupportedIOS() && (utils.isSafari() || utils.isChrome() || utils.isFacebook());
            var androidBrowserIsSupported = utils.isAndroid() && utils.isChrome();
            var mobileBrowserIsSupported = (iosBrowserIsSupported || androidBrowserIsSupported);
            var isAndroidSdk = _this.get('sdkplatform') === 1;
            return (!_this.get('sdkplatform') && autostartAdsIsEnabled && mobileBrowserIsSupported) || isAndroidSdk;
        }

        this.autoStartOnMobile = function() {
            return this.get('autostart') && platformCanAutostart();
        };

        // Mobile players always wait to become viewable.
        // Desktop players must have autostart set to viewable
        this.setAutoStart = function(autoStart) {
            if (!_.isUndefined(autoStart)) {
                this.set('autostart', autoStart);
            }

            const autoStartOnMobile = this.autoStartOnMobile();
            if (autoStartOnMobile) {
                this.set('autostartMuted', true);
            }
            this.set('playOnViewable', autoStartOnMobile || this.get('autostart') === 'viewable');
        };
    };

    // Represents the state of the provider/media element
    var MediaModel = Model.MediaModel = function() {
        this.set('state', states.IDLE);
    };

    _.extend(Model.prototype, SimpleModel);
    _.extend(MediaModel.prototype, SimpleModel);

    return Model;
});
