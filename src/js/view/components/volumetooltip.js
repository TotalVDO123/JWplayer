define([
    'view/components/tooltip',
    'view/components/slider',
    'utils/helpers'
], function(Tooltip, Slider, utils) {
    var VolumeTooltip = Tooltip.extend({
        'constructor' : function(_model, _api, name) {
            this._model = _model;
            this._api = _api;

            Tooltip.call(this, name);

            this.volumeSlider = new Slider('jw-volume jw-volume-tip', 'vertical');
            this.addContent(this.volumeSlider.element());

            this.volumeSlider.on('update', function (evt) {
                this.trigger('update', evt);
            }.bind(this));

            utils.toggleClass(this.el, 'jw-hidden', false);

            this.el.addEventListener('click', this.toggle.bind(this));

            this._model.on('change:volume', this.onVolume, this);
        },
        toggle : function(evt){
            if(evt.target === this.el){
                this.trigger('toggle');
            }
        }
    });

    return VolumeTooltip;
});

