define([
    'providers/html5',
    'providers/flash',
    'providers/youtube',
    'underscore'
    ], function(html5, flash, youtube, _) {


    function Providers(primary) {
        this.providers = Providers.defaultList.slice();

        if (primary === 'flash') {
            swap(this.providers, html5, flash);
        }
    }

    // When choosing a provider, go through this array
    //   and select the first that works for the source
    Providers.defaultList = [html5, flash, youtube];

    _.extend(Providers.prototype, {

        choose : function(source) {
            // prevent throw on missing source
            source = _.isObject(source) ? source : {};

            var chosen = _.find(this.providers, function (provider) {
                return provider.supports(source);
            });

            return chosen;
        },

        priority : function(p) {
            var idx = _.indexOf(this.providers, p);
            if (idx < 0) {
                // No provider matched
                return Number.MIN_VALUE;
            }

            // prefer earlier providers
            return this.providers.length - idx;
        }
    });

    function swap(arr, left, right) {
        var l = _.indexOf(arr, left);
        var r = _.indexOf(arr, right);

        var temp = arr[l];
        arr[l] = arr[r];
        arr[r] = temp;
    }

    return Providers;
});