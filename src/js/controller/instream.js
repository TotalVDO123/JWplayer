define([
    'utils/helpers',
    'utils/css',
    'underscore',
    'utils/eventdispatcher',
    'events/events',
    'events/states',
    'controller/model',
    'view/display',
    'view/controlbar',
    'view/adskipbutton',
    'playlist/item'
], function(utils, cssUtils, _, eventdispatcher,
            events, states, Model, Display, Controlbar, Adskipbutton, PlaylistItem) {

    var Instream = function(_controller, _model, _view) {
        var _defaultOptions = {
            controlbarseekable: 'never',
            controlbarpausable: true,
            controlbarstoppable: true,
            loadingmessage: 'Loading ad',
            playlistclickable: true,
            skipoffset: null,
            tag: null
        };

        var _item,
            _array, // the copied in playlist
            _arrayIndex = 0,
            _optionList,
            _options = { // these are for before load
                controlbarseekable: 'never',
                controlbarpausable: false,
                controlbarstoppable: false
            },
            _skipButton,
            _oldProvider,
            _oldpos,
            _oldstate,
            _olditem,
            _adModel,
            _currentProvider,
            _cbar,
            _instreamDisplay,
            _instreamContainer,
            _completeTimeoutId = -1,
            _this = _.extend(this, new eventdispatcher());

        // Listen for player resize events
        _controller.jwAddEventListener(events.JWPLAYER_RESIZE, _resize);
        _controller.jwAddEventListener(events.JWPLAYER_FULLSCREEN, _fullscreenHandler);

        /*****************************************
         *****  Public instream API methods  *****
         *****************************************/

        _this.init = function() {

            /** Blocking playback and show Instream Display **/

            // Make sure the original player's provider stops broadcasting events (pseudo-lock...)
            _oldProvider = _controller.detachMedia();


            // Initialize the instream player's model copied from main player's model
            _adModel = new Model({
                id: _model.id,
                volume: _model.volume,
                fullscreen: _model.fullscreen,
                mute: _model.mute
            });
            _checkProvider();
            _adModel.addEventListener('fullscreenchange', _nativeFullscreenHandler);
            _olditem = _model.playlist[_model.item];

            // Keep track of the original player state
            _oldpos = _oldProvider.currentTime;

            if ( _controller.checkBeforePlay() || (_oldpos === 0 && !_model.getVideo().checkComplete()) ) {
                // make sure video restarts after preroll
                _oldpos = 0;
                _oldstate = states.PLAYING;
            } else if (_model.getVideo() && _model.getVideo().checkComplete()) {
                 // AKA  postroll
                 _oldstate = states.IDLE;
             }  else if (_controller.jwGetState() === states.IDLE) {
                _oldstate = states.IDLE;
            } else {
                _oldstate = states.PLAYING;
            }

            // If the player's currently playing, pause the video tag
            if (_oldstate === states.PLAYING) {
                _oldProvider.pause();
            }

            // Instream display
            _instreamDisplay = new Display(_view._skin, jwplayer(_controller.id), _adModel);
            _instreamDisplay.forceState(states.BUFFERING);
            // Create the container in which the controls will be placed
            _instreamContainer = document.createElement('div');
            _instreamContainer.id = _this.id + '_instream_container';
            cssUtils.style(_instreamContainer, {
                width: '100%',
                height: '100%'
            });

            _instreamContainer.appendChild(_instreamDisplay.element());

            // Instream controlbar
            _cbar = new Controlbar(_view._skin, jwplayer(_controller.id), _adModel);
            _cbar.instreamMode(true);
            _instreamContainer.appendChild(_cbar.element());

            if (_controller.jwGetControls()) {
                _cbar.show();
                _instreamDisplay.show();
            } else {
                _cbar.hide();
                _instreamDisplay.hide();
            }

            // Show the instream layer
            _view.setupInstream(_instreamContainer, _cbar, _instreamDisplay, _adModel);

            // Resize the instream components to the proper size
            _resize();

            _this.jwInstreamSetText(_defaultOptions.loadingmessage);
        };

        /** Load an instream item and initialize playback **/
        _this.load = function(item, options) {
            if (utils.isAndroid(2.3)) {
                errorHandler({
                    type: events.JWPLAYER_ERROR,
                    message: 'Error loading instream: Cannot play instream on Android 2.3'
                });
                return;
            }
            _sendEvent(events.JWPLAYER_PLAYLIST_ITEM, {
                index: _arrayIndex
            }, true);

            var instreamLayer = _instreamContainer.parentNode;
            var bottom = 10 + utils.bounds(instreamLayer).bottom - utils.bounds(_cbar.element()).top;

            // Copy the playlist item passed in and make sure it's formatted as a proper playlist item
            if (_.isArray(item)) {
                if (options) {
                    _optionList = options;
                    options = options[_arrayIndex];
                }
                _array = item;
                item = _array[_arrayIndex];
            }
            _options = _.extend(_defaultOptions, options);
            _item = new PlaylistItem(item);

            _adModel.setPlaylist([item]);
            // check provider after item change
            _checkProvider();

            _skipButton = new Adskipbutton(_controller.id, bottom, _options.skipMessage, _options.skipText);
            _skipButton.addEventListener(events.JWPLAYER_AD_SKIPPED, _skipAd);
            _skipButton.reset(_options.skipoffset || -1);


            if (_controller.jwGetControls()) {
                _skipButton.show();
            } else {
                _skipButton.hide();
            }


            var skipElem = _skipButton.element();
            _instreamContainer.appendChild(skipElem);
            // Match the main player's controls state
            _adModel.addEventListener(events.JWPLAYER_ERROR, errorHandler);

            // start listening for ad click
            _instreamDisplay.setAlternateClickHandler(function(evt) {
                evt = evt || {};
                evt.hasControls = !!_controller.jwGetControls();

                _sendEvent(events.JWPLAYER_INSTREAM_CLICK, evt);

                // toggle playback after click event

                if (_adModel.state === states.PAUSED) {
                    if (evt.hasControls) {
                        _this.jwInstreamPlay();
                    }
                } else {
                    _this.jwInstreamPause();
                }
            });

            if (utils.isMSIE()) {
                _oldProvider.parentElement.addEventListener('click', _instreamDisplay.clickHandler);
            }

            _view.addEventListener(events.JWPLAYER_AD_SKIPPED, _skipAd);

            // Load the instream item
            _adModel.getVideo().load(_adModel.playlist[0]);
            //_fakemodel.getVideo().addEventListener('webkitendfullscreen', _fullscreenChangeHandler, FALSE);
        };

        function errorHandler(evt) {
            _sendEvent(evt.type, evt);

            if (_adModel) {
                _controller.jwInstreamDestroy(false, _this);
            }
        }

        /** Stop the instream playback and revert the main player back to its original state **/
        _this.jwInstreamDestroy = function(complete) {
            if (!_adModel) {
                return;
            }
            _adModel.removeEventListener('fullscreenchange',_nativeFullscreenHandler);
            clearTimeout(_completeTimeoutId);
            _completeTimeoutId = -1;
            _adModel.getVideo().detachMedia();
            // Re-attach the controller
            _controller.attachMedia();
            // Load the original item into our provider, which sets up the regular player's video tag
            if (_oldstate !== states.IDLE) {
                var item = _.extend({}, _olditem);
                item.starttime = _oldpos;
                _model.getVideo().load(item);

            } else {
                _model.getVideo().stop();
            }
            _this.resetEventListeners();

            // We don't want the instream provider to be attached to the video tag anymore

            _adModel.getVideo().resetEventListeners();
            _adModel.resetEventListeners();



            // If we added the controlbar anywhere, let's get rid of it
            if (_cbar) {
                utils.tryCatch(function() {
                    _cbar.element().parentNode.removeChild(_cbar.element());
                });
            }
            if (_instreamDisplay) {
                if (_oldProvider && _oldProvider.parentElement) {
                    _oldProvider.parentElement.removeEventListener('click', _instreamDisplay.clickHandler);
                }
                _instreamDisplay.revertAlternateClickHandler();
            }
            // Let listeners know the instream player has been destroyed, and why
            _sendEvent(events.JWPLAYER_INSTREAM_DESTROYED, {
                reason: complete ? 'complete' : 'destroyed'
            }, true);



            if (_oldstate === states.PLAYING) {
                // Model was already correct; just resume playback
                _oldProvider.play();
            }

            // Return the view to its normal state
            _view.destroyInstream(_adModel.getVideo().isAudioFile());
            _adModel = null;
        };

        /** Start instream playback **/
        _this.jwInstreamPlay = function() {
            //if (!_item) return;
            _adModel.getVideo().play(true);

            // Show the instream layer
            _view.showInstream();
        };

        /** Pause instream playback **/
        _this.jwInstreamPause = function() {
            //if (!_item) return;
            _adModel.getVideo().pause(true);
            if (_controller.jwGetControls()) {
                _instreamDisplay.show();
                _cbar.show();
            }
        };

        /** Seek to a point in instream media **/
        _this.jwInstreamSeek = function(position) {
            //if (!_item) return;
            _adModel.getVideo().seek(position);
        };

        /** Set custom text in the controlbar **/
        _this.jwInstreamSetText = function(text) {
            _cbar.setText(text);
        };

        _this.jwInstreamState = function() {
            //if (!_item) return;
            return _adModel.state;
        };

        /*****************************
         ****** Private methods ******
         *****************************/

        function _checkProvider() {
            var provider = _adModel.getVideo();

            if (_currentProvider !== provider) {
                _currentProvider = provider;

                if (!provider) {
                    return;
                }

                provider.resetEventListeners();

                provider.addGlobalListener(_forward);
                provider.addEventListener(events.JWPLAYER_MEDIA_META, _metaHandler);
                provider.addEventListener(events.JWPLAYER_MEDIA_COMPLETE, _completeHandler);
                provider.addEventListener(events.JWPLAYER_MEDIA_BUFFER_FULL, _bufferFullHandler);
                provider.addEventListener(events.JWPLAYER_MEDIA_ERROR, errorHandler);

                provider.addEventListener(events.JWPLAYER_PLAYER_STATE, stateHandler);
                provider.addEventListener(events.JWPLAYER_MEDIA_TIME, function(evt) {
                    if (_skipButton) {
                        _skipButton.updateSkipTime(evt.position, evt.duration);
                    }
                });
                provider.attachMedia();
                provider.mute(_model.mute);
                provider.volume(_model.volume);
            }
        }

        function stateHandler(evt) {
            switch(evt.newstate) {
                case states.PLAYING:
                    _this.jwInstreamPlay();
                    break;
                case states.PAUSED:
                    _this.jwInstreamPause();
                    break;
            }
        }

        function _skipAd(evt) {
            _sendEvent(evt.type, evt);
            _completeHandler();
        }
        /** Forward provider events to listeners **/
        function _forward(evt) {
            _sendEvent(evt.type, evt);
        }
        
        function _nativeFullscreenHandler(evt) {
            _model.sendEvent(evt.type,evt);
            _sendEvent(events.JWPLAYER_FULLSCREEN, {fullscreen:evt.jwstate});
        }
        function _fullscreenHandler(evt) {
            // required for updating the controlbars toggle icon
            _forward(evt);
            if (!_adModel) {
                return;
            }
            _resize();
            if (!evt.fullscreen && utils.isIPad()) {
                if (_adModel.state === states.PAUSED) {
                    _instreamDisplay.show(true);
                } else if (_adModel.state === states.PLAYING) {
                    _instreamDisplay.hide();
                }
            }
        }

        /** Handle the JWPLAYER_MEDIA_BUFFER_FULL event **/
        function _bufferFullHandler() {
            if (_instreamDisplay) {
                _instreamDisplay.releaseState(_this.jwGetState());
            }
            _adModel.getVideo().play();
        }

        /** Handle the JWPLAYER_MEDIA_COMPLETE event **/
        function _completeHandler() {
            if (_array && _arrayIndex + 1 < _array.length) {
                _arrayIndex++;
                var item = _array[_arrayIndex];
                _item = new PlaylistItem(item);
                _adModel.setPlaylist([item]);
                // check provider after item change
                _checkProvider();

                var curOpt;
                if (_optionList) {
                    curOpt = _optionList[_arrayIndex];
                }
                _options = _.extend(_defaultOptions, curOpt);
                _adModel.getVideo().load(_adModel.playlist[0]);
                _skipButton.reset(_options.skipoffset || -1);
                _completeTimeoutId = setTimeout(function() {
                    _sendEvent(events.JWPLAYER_PLAYLIST_ITEM, {
                        index: _arrayIndex
                    }, true);
                }, 0);
            } else {
                _completeTimeoutId = setTimeout(function() {
                    // this is called on every ad completion of the final video in a playlist
                    //   1) vast.js (to trigger ad_complete event)
                    //   2) display.js (to set replay icon and image)
                    _sendEvent(events.JWPLAYER_PLAYLIST_COMPLETE, {}, true);
                    _controller.jwInstreamDestroy(true, _this);
                }, 0);
            }
        }

        /** Handle the JWPLAYER_MEDIA_META event **/
        function _metaHandler(evt) {
            // If we're getting video dimension metadata from the provider, allow the view to resize the media
            if (evt.width && evt.height) {
                if (_instreamDisplay) {
                    _instreamDisplay.releaseState(_this.jwGetState());
                }
                _view.resizeMedia();
            }
        }

        function _sendEvent(type, data) {
            data = data || {};
            if (_defaultOptions.tag && !data.tag) {
                data.tag = _defaultOptions.tag;
            }
            _this.sendEvent(type, data);
        }

        // Resize handler; resize the components.
        function _resize() {
            if (_cbar) {
                _cbar.redraw();
            }
            if (_instreamDisplay) {
                _instreamDisplay.redraw();
            }
        }

        _this.setControls = function(mode) {
            if (mode) {
                _skipButton.show();
            } else {
                _skipButton.hide();
            }
        };

        /**************************************
         *****  Duplicate main html5 api  *****
         **************************************/

        _this.jwPlay = function() {
            if (_options.controlbarpausable.toString().toLowerCase() === 'true') {
                _this.jwInstreamPlay();
            }
        };

        _this.jwPause = function() {
            if (_options.controlbarpausable.toString().toLowerCase() === 'true') {
                _this.jwInstreamPause();
            }
        };

        _this.jwStop = function() {
            if (_options.controlbarstoppable.toString().toLowerCase() === 'true') {
                _controller.jwInstreamDestroy(false, _this);
                _controller.jwStop();
            }
        };

        _this.jwSeek = function(position) {
            switch (_options.controlbarseekable.toLowerCase()) {
                case 'never':
                    return;
                case 'always':
                    _this.jwInstreamSeek(position);
                    break;
                case 'backwards':
                    if (_adModel.position > position) {
                        _this.jwInstreamSeek(position);
                    }
                    break;
            }
        };

        _this.jwSeekDrag = function(state) {
            _adModel.seekDrag(state);
        };

        _this.jwGetPosition = function() {};
        _this.jwGetDuration = function() {};
        _this.jwGetWidth = _controller.jwGetWidth;
        _this.jwGetHeight = _controller.jwGetHeight;
        _this.jwGetFullscreen = _controller.jwGetFullscreen;
        _this.jwSetFullscreen = _controller.jwSetFullscreen;
        _this.jwGetVolume = function() {
            return _model.volume;
        };
        _this.jwSetVolume = function(vol) {
            _adModel.setVolume(vol);
            _controller.jwSetVolume(vol);
        };
        _this.jwGetMute = function() {
            return _model.mute;
        };
        _this.jwSetMute = function(state) {
            _adModel.setMute(state);
            _controller.jwSetMute(state);
        };
        _this.jwGetState = function() {
            if (!_adModel) {
                return states.IDLE;
            }
            return _adModel.state;
        };
        _this.jwGetPlaylist = function() {
            return [_item];
        };
        _this.jwGetPlaylistIndex = function() {
            return 0;
        };
        _this.jwGetStretching = function() {
            return _model.config.stretching;
        };
        _this.jwAddEventListener = function(type, handler) {
            _this.addEventListener(type, handler);
        };
        _this.jwRemoveEventListener = function(type, handler) {
            _this.removeEventListener(type, handler);
        };

        _this.jwSetCurrentQuality = function() {};
        _this.jwGetQualityLevels = function() {
            return [];
        };

        // for supporting api interface in html5 display
        _this.jwGetControls = function() {
            return _controller.jwGetControls();
        };

        _this.skin = _view._skin;
        _this.id = _controller.id + '_instream';

        return _this;
    };

    return Instream;
});
