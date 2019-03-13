const request = require('request-promise-native');
const debug = require('debug')('babbling:youtube');

const BaseApp = require('./base');
const { awaitMessageOfType } = require('./util');

const APP_ID = '3EC252A5';
const HULU_PLUS_NS = 'urn:x-cast:com.hulu.plus';

const CSRF_URL = 'https://www.hulu.com/api/3.0/generate_csrf_value?&for_hoth=true&path=/v1/web/chromecast/authenticate';
const CSRF_COOKIE_NAME = '_tcv';

const CHROMECAST_AUTH_URL = 'https://auth.hulu.com/v1/web/chromecast/authenticate';

const ENTITY_DISCOVER_URL = 'https://discover.hulu.com/content/v4/entity/deeplink?schema=2&referral_host=www.hulu.com';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36';

function extractCookie(cookies, cookieName) {
    const cookieStart = cookies.indexOf(cookieName);
    const cookieEnd = cookies.indexOf(';', cookieStart);
    return cookies.substring(cookieStart + cookieName.length + 1, cookieEnd);
}

function eabIdFromEntity(entity) {
    if (entity.bundle && entity.bundle.eab_id) {
        return entity.bundle.eab_id;
    }
    const contentId = entity.content_id || 'NULL';
    const bundleId = entity.bundle ? entity.bundle.id : 'NULL';
    return `EAB::${entity.id}::${contentId}::${bundleId}`;
}

class HuluApp extends BaseApp {

    /**
     * Options:
     * - cookies: A string of cookies as might be retrieved from the
     *   "copy as cURL" from any request on hulu.com in Chrome's
     *   network inspector
     */
    constructor(device, options) {
        super(device, {
            appId: APP_ID,
            sessionNs: HULU_PLUS_NS,
        });

        this.cookies = '';
        if (options && options.cookies) {
            const { cookies } = options;
            if (typeof cookies !== 'string') {
                throw new Error('Invalid cookies format');
            }

            this.cookies = cookies.trim();
        }

        this._userId = extractCookie(this.cookies, '_hulu_uid');
        this._profileId = extractCookie(this.cookies, '_hulu_pid');
        debug('userId=', this._userId, 'profileId=', this._profileId);
    }

    /**
     * Options:
     * - startTime: Time in seconds to start playback. Defaults to 0
     */
    async play(videoId, options) {
        const [ , s, entity ] = await Promise.all([
            this._ensureUserToken(),
            this._ensureCastSession(),
            this._loadEntityById(videoId),
        ]);

        const { startTime } = Object.assign({
            startTime: 0,
        }, options);

        const data = {
            "autoplay": {
                "autoplay": "on",
            },
            "caption_style_data": {
                "background_color": 2130706432,
                "edge_color": 0,
                "edge_type": "dropshadow",
                "font_family": "Arial",
                "text_color": 4294967295,
                "text_size": 0.7777777777777778,
            },
            "captions_language": "en",
            "eab_id": eabIdFromEntity(entity),
            "entity": entity,
            "expiration_time": 43200000,
            "latitude": -1,
            "limit_ad_tracking": true,
            "longitude": -1,
            "offset_msec": startTime * 1000,
            "profile": {
                "profile_id": this._profileId,
            },
            "show_prerolls": true,
            "user_id": this._userId,
            "user_token": this._userToken,
        };

        s.send({
            message_id: 1,
            event_type: 'start',
            data,
        });

        debug('sent');
        let ms;
        do {
            ms = await awaitMessageOfType(s, 'MEDIA_STATUS');
            debug(ms);
        } while (!ms.status.length);
        debug(ms.status[0].media);

    }

    async _ensureUserToken() {
        if (this._userToken) return;

        await this._ensureCSRF();

        debug('fetch user token', this.cookies);
        debug(` -> csrf='${this._csrf}'`);
        const rawResponse = await request.post({
            url: CHROMECAST_AUTH_URL,
            body: `csrf=${this._csrf}`,
            headers: {
                Cookie: this.cookies,
                'Content-Type': 'text/plain;charset=UTF-8',
                Origin: 'https://www.hulu.com',
                Referer: 'https://www.hulu.com/',
                'User-Agent': USER_AGENT,
                Accept: 'application/json',
            },
        });
        const json = JSON.parse(rawResponse);
        debug('got:', json);

        this._userToken = json.user_token;
        this._userTokenExpires = Date.now() + json.expires_in * 1000;
    }

    async _ensureCSRF() {
        if (this._csrf) return;

        debug('fetch CSRF');
        const response = await request({
            url: CSRF_URL,
            headers: {
                Cookie: this.cookies,
                'User-Agent': USER_AGENT,
                authority: 'www.hulu.com',
                referer: 'https://www.hulu.com/',
            },
            resolveWithFullResponse: true,
        });
        debug(`got cookies:`, response.headers['set-cookie']);
        debug('body=', response.body);

        for (const raw of response.headers['set-cookie']) {
            if (!raw.startsWith(CSRF_COOKIE_NAME)) continue;

            const csrf = raw.substring(CSRF_COOKIE_NAME.length + 1, raw.indexOf(';'));
            this._csrf = csrf;
            debug(`got CSRF token: ${csrf}`);
        }

        if (!this._csrf) {
            throw new Error('Could not get CSRF token');
        }
    }

    async _loadEntityById(entityId) {

        const { entity } = await request({
            url: ENTITY_DISCOVER_URL,
            json: true,
            qs: {
                entity_id: entityId,
            },
            headers: {
                Cookie: this.cookies,
                Origin: 'https://www.hulu.com',
                Referer: 'https://www.hulu.com/',
                'User-Agent': USER_AGENT,
            },
        });

        if (entity._type !== 'episode') {
            // for example, 'series'; in the future, we could try
            // to support resuming a series by id...
            throw new Error(`Unsupported entity '${entity.name}' (type '${entity._type}')`);
        }

        return entity;
    }

}

module.exports = HuluApp;
