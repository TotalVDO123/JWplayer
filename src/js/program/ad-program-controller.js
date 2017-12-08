import ProgramController from 'program/program-controller';
import AdMediaPool from 'program/ad-media-pool';
import Model from 'controller/model';
import { Features, OS } from 'environment/environment';
import changeStateEvent from 'events/change-state-event';
import { ERROR, FULLSCREEN, MEDIA_COMPLETE, PLAYER_STATE, STATE_PLAYING, STATE_PAUSED } from 'events/events';

export default class AdProgramController extends ProgramController {
    constructor(model, mediaPool) {
        super(model, mediaPool);
        const adModel = this.model = new Model();
        this.playerModel = model;
        this.provider = null;

        if (!Features.backgroundLoading) {
            const mediaElement = model.get('mediaElement');
            adModel.attributes.mediaElement = mediaElement;
            adModel.attributes.mediaSrc = mediaElement.src;

            // Listen to media element for events that indicate src was reset or load() was called
            mediaElement.addEventListener('abort', this.srcReset);
            mediaElement.addEventListener('emptied', this.srcReset);
            this.mediaPool = AdMediaPool(mediaElement);
        }
    }

    setup() {
        const { model, mediaPool, playerModel } = this;
        const playerAttributes = playerModel.attributes;
        const mediaModelContext = playerModel.mediaModel;
        model.setup({
            id: playerAttributes.id,
            volume: playerAttributes.volume,
            instreamMode: true,
            edition: playerAttributes.edition,
            mediaContext: mediaModelContext,
            mute: playerModel.getMute(),
            streamType: 'VOD',
            autostartMuted: playerAttributes.autostartMuted,
            autostart: playerAttributes.autostart,
            advertising: playerAttributes.advertising,
            sdkplatform: playerAttributes.sdkplatform,
            skipButton: false
        });

        if (!OS.mobile) {
            model.set('mediaContainer', playerModel.get('mediaContainer'));
        }

        model.on('fullscreenchange', this._nativeFullscreenHandler);
        model.on('change:state', changeStateEvent, this);
        model.on(ERROR, function(data) {
            this.trigger(ERROR, data);
        }, this);


        if (!Features.backgroundLoading) {
            const mediaElement = mediaPool.getPrimedElement();
            if (!mediaElement.paused) {
                mediaElement.pause();
            }
            mediaElement.playbackRate = mediaElement.defaultPlaybackRate = 1;
            model.mediaElement = mediaElement;
            model.mediaSrc = mediaElement.src;
        }
    }

    setActiveItem(item, index) {
        this.stopVideo();
        this.provider = null;
        super.setActiveItem(item, index)
            .then((mediaController) => {
                this._setProvider(mediaController.provider);
            });
        return this.playVideo();
    }

    usePsuedoProvider(provider) {
        this.provider = provider;
        if (!provider) {
            return;
        }
        const { playerModel } = this;
        this._setProvider(provider);

        // Match the main player's controls state
        provider.off(ERROR);
        provider.on(ERROR, function(data) {
            this.trigger(ERROR, data);
        }, this);
        playerModel.on('change:volume', function(data, value) {
            this.volume = value;
        }, this);
        playerModel.on('change:mute', function(data, value) {
            this.mute = value;
        }, this);
        playerModel.on('change:autostartMuted', function(data, value) {
            if (!value) {
                provider.mute(playerModel.get('mute'));
            }
        }, this);
    }

    _setProvider(provider) {
        // Clear current provider when applyProviderListeners(null) is called
        if (!provider) {
            return;
        }

        const { model, playerModel } = this;
        const isVpaidProvider = provider.type === 'vpaid';

        provider.off();
        provider.on('all', function(type, data) {
            if (isVpaidProvider && (type === MEDIA_COMPLETE)) {
                return;
            }
            this.trigger(type, Object.assign({}, data, { type: type }));
        }, this);

        const adMediaModelContext = model.mediaModel;
        provider.on(PLAYER_STATE, (event) => {
            adMediaModelContext.set(PLAYER_STATE, event.newstate);
        });
        adMediaModelContext.on('change:' + PLAYER_STATE, (changeAdModel, state) => {
            this._stateHandler(state);
        });
        provider.attachMedia();
        provider.volume(playerModel.get('volume'));
        provider.mute(playerModel.get('mute') || playerModel.get('autostartMuted'));
        if (provider.setPlaybackRate) {
            provider.setPlaybackRate(1);
        }
    }


    destroy() {
        const { mediaController, model } = this;

        model.off();
        if (mediaController) {
            this._destroyActiveMedia();
        }

        if (!Features.backgroundLoading) {
            const mediaElement = model.get('mediaElement');
            if (mediaElement) {
                mediaElement.removeEventListener('abort', this.srcReset);
                mediaElement.removeEventListener('emptied', this.srcReset);
                // Reset the player media model if the src was changed externally
                if (mediaElement.src !== model.get('mediaSrc')) {
                    this.srcReset();
                }
            }
        }
    }

    srcReset() {
        const { playerModel } = this;
        if (Features.backgroundLoading || !playerModel) {
            return;
        }

        playerModel.get('mediaModel').srcReset();
    }

    _nativeFullscreenHandler(evt) {
        const { model } = this;
        model.trigger(evt.type, evt);
        this.trigger(FULLSCREEN, {
            fullscreen: evt.jwstate
        });
    }

    _stateHandler(state) {
        const { model } = this;
        switch (state) {
            case STATE_PLAYING:
            case STATE_PAUSED:
                model.set(PLAYER_STATE, state);
                break;
            default:
                break;
        }
    }

    set mute(mute) {
        const { mediaController, provider } = this;
        super.mute = mute;
        if (!mediaController) {
            provider.mute(mute);
        }
    }

    set volume(volume) {
        const { mediaController, provider } = this;
        super.volume = volume;
        if (!mediaController) {
            provider.volume(volume);
        }
    }
}
