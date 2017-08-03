import ProvidersSupported from 'providers/providers-supported';
import registerProvider from 'providers/providers-register';
import ProvidersLoaded from 'providers/providers-loaded';

function Providers(config) {
    this.config = config || {};
}

export const Loaders = {
    html5: function() {
        return require.ensure(['providers/html5'], function(require) {
            const provider = require('providers/html5');
            registerProvider(provider);
            return provider;
        }, 'provider.html5');
    },
    flash: function() {
        return require.ensure(['providers/flash'], function(require) {
            const provider = require('providers/flash');
            registerProvider(provider);
            return provider;
        }, 'provider.flash');
    },
    youtube: function() {
        return require.ensure(['providers/youtube'], function(require) {
            const provider = require('providers/youtube');
            registerProvider(provider);
            return provider;
        }, 'provider.youtube');
    }
};

Object.assign(Providers.prototype, {

    load: function(providersToLoad) {
        return Promise.all(providersToLoad.map(function(provider) {
            // Resolve event for unknown registered providers
            const providerLoaderMethod = Loaders[provider.name] || Promise.resolve;
            return providerLoaderMethod();
        }));
    },

    providerSupports: function(provider, source) {
        return provider.supports(source);
    },

    required: function(playlist) {
        playlist = playlist.slice();
        return ProvidersSupported.filter((provider) => {
            // remove items from copied playlist that can be played by provider
            // remaining providers will be checked against any remaining items
            // provider will be loaded if there are matches
            let loadProvider = false;
            for (let i = playlist.length; i--;) {
                const item = playlist[i];
                const supported = this.providerSupports(provider, item.sources[0]);
                if (supported) {
                    playlist.splice(i, 1);
                }
                loadProvider = loadProvider || supported;
            }
            return loadProvider;
        });
    },

    // Find the name of the first provider which can support the media source-type
    choose: function(source) {
        // prevent throw on missing source
        source = (source === Object(source)) ? source : {};

        const count = ProvidersSupported.length;
        for (let i = 0; i < count; i++) {
            const provider = ProvidersSupported[i];
            if (this.providerSupports(provider, source)) {
                // prefer earlier providers
                const priority = count - i - 1;

                return {
                    priority: priority,
                    name: provider.name,
                    type: source.type,
                    providerToCheck: provider,
                    // If provider isn't loaded, this will be undefined
                    provider: ProvidersLoaded[provider.name]
                };
            }
        }

        return null;
    }
});

export default Providers;
