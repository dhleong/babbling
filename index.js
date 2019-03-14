const { ChromecastDevice } = require('./lib/device');

const BaseApp = require('./lib/apps/base');
const HuluApp = require('./lib/apps/hulu');
const YoutubeApp = require('./lib/apps/youtube');

module.exports = {
    ChromecastDevice,

    // apps export:
    HuluApp,
    YoutubeApp,

    // and also Base so 3rd parties can implement their own
    BaseApp,
};
