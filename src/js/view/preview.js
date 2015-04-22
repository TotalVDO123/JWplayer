define([
    'utils/underscore'

], function(_) {

    var Preview = function(_model) {
        this.model = _model;

        this.setup();
        this.model.on('change:playlistItem', this.loadImage);
    };

    _.extend(Preview.prototype, {
        setup: function() {
            this.el = document.createElement('div');
            this.el.className = 'jw-preview';

            this.loadImage(this.model, this.model.get('playlistItem'));
        },
        loadImage: function(model, playlistItem) {
            var img = playlistItem.image;

            if (_.isString(img)) {
                this.el.style['background-image'] = 'url(' + img + ')';
            } else {
                this.el.style['background-image'] = '';
            }
        },

        element : function() {
            return this.el;
        }
    });

    return Preview;
});
