const { ChromecastDevice } = require('./lib/device');

module.exports = {
    ChromecastDevice,
};

(async () => {
    const device = new ChromecastDevice('Family Room TV');
    const app = await device.openApp('youtube');
    await app.play('GWb7zhBBnUE');
    device.close();

    console.log('done!');
})().catch(e => console.error(e));
