/**
 * Based on https://github.com/ur1katz/casttube
 */

const request = require('request-promise-native');
const debug = require('debug')('babbling:youtube');

const BaseApp = require('./base');

const APP_ID = '233637DE';
const MDX_NS = 'urn:x-cast:com.google.youtube.mdx';

const YOUTUBE_BASE_URL = 'https://www.youtube.com/';
const URLS = {
    bind: YOUTUBE_BASE_URL + 'api/lounge/bc/bind',
    loungeToken: YOUTUBE_BASE_URL + 'api/lounge/pairing/get_lounge_token_batch',
};

const BIND_DATA = {
    device: 'REMOTE_CONTROL',
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Babbling',
    'mdx-version': 3,
    pairing_type: 'cast',
    app: 'android-phone-13.14.55',
};

const KEYS = {
    action: '__sc',
    audioOnly: '_audioOnly',
    count: 'count',
    currentIndex: '_currentIndex',
    currentTime: '_currentTime',
    list_id: '_listId',
    listId: '_listId',
    videoId: '_videoId',
};

const ACTIONS = {
    setPlaylist: "setPlaylist",
    clear: "clearPlaylist",
    remove: "removeVideo",
    insert: "insertVideo",
    add: "addVideo",
};

const GSESSION_ID_REGEX = /"S","(.*?)"]/;
const SID_REGEX = /"c","(.*?)","/;

const awaitMessageOfType = (session, type) => new Promise((resolve, reject) => {
    let onMessage;
    const timeoutId = setTimeout(() => {
        session.removeListener('message', onMessage);
        reject(new Error("Timeout waiting for " + type));
    }, 5000);
    onMessage = message => {
        if (message.type === type) {
            clearTimeout(timeoutId);
            session.removeListener('message', onMessage);
            resolve(message);
        }
    };
    session.on('message', onMessage);
});

async function getMdxScreenId(session) {
    session.send({ type: 'getMdxSessionStatus' });
    const status = await awaitMessageOfType(session, 'mdxSessionStatus');
    return status.data.screenId;
}

class YoutubeApp extends BaseApp {
    constructor(device) {
        super(device, {
            appId: APP_ID,
            sessionNs: MDX_NS,
        });
    }

    async play(videoId, listId = '') {
        // TODO support video URLs?
        await this._ensureYoutubeSession();
        await this._sessionRequest(URLS.bind, {
            data: {
                [KEYS.listId]: listId,
                [KEYS.action]: ACTIONS.setPlaylist,
                [KEYS.currentTime]: '0',
                [KEYS.currentIndex]: -1,
                [KEYS.audioOnly]: "false",
                [KEYS.videoId]: videoId,
                [KEYS.count]: 1,
            },
        });
    }

    /**
     * Add a video to the end of the queue
     */
    async addToQueue(videoId) {
        await this._queueAction(videoId, ACTIONS.add);
    }

    async playNext(videoId) {
        await this._queueAction(videoId, ACTIONS.insert);
    }

    async playVideo(videoId) {
        await this._queueAction(videoId, ACTIONS.remove);
    }

    async clearPlaylist() {
        await this._queueAction('', ACTIONS.clear);
    }

    get inSession() {
        return this._loungeId && this._gsessionId;
    }

    async _ensureYoutubeSession() {
        if (this.inSession) {
            return;
        }

        await this._ensureLoungeId();
        await this._bind();
    }

    async _ensureLoungeId() {
        const s = await this._ensureCastSession();
        const screenId = await getMdxScreenId(s);

        const existing = this._loungeId;
        if (existing && this._existingScreen === screenId) {
            return existing;
        }

        const response = await request.post({
            url: URLS.loungeToken,
            json: true,
            form: {
                screen_ids: screenId,
            },
        });

        debug('loungeIdResponse:', response);

        const token = response.screens[0].loungeToken;
        this._loungeId = token;
        this._existingScreen = screenId;

        return token;
    }

    async _bind() {
        this._rid = 0;
        this._next_request_id = 0;

        const r = await this._sessionRequest(URLS.bind, {
            data: BIND_DATA,
            isBind: true,
        });

        debug('bind response', r);

        const [ , sid ] = r.match(SID_REGEX);
        const [ , gsessionId ] = r.match(GSESSION_ID_REGEX);

        this._sid = sid;
        this._gsessionId = gsessionId;

        debug('got sid=', sid, 'gsid=', gsessionId);
    }

    async _queueAction(videoId, action) {
        // If nothing is playing actions will work but won"t affect the queue.
        // This is for binding existing sessions
        if (!this.inSession) {
            await this._ensureYoutubeSession();
        } else {
            // There is a bug that causes session to get out of sync after about 30 seconds. Binding again works.
            // Binding for each session request has a pretty big performance impact
            await this._bind();
        }

        await this._sessionRequest(URLS.bind, {
            data: {
                [KEYS.action]: action,
                [KEYS.videoId]: videoId,
                [KEYS.count]: 1,
            },
        });
    }

    async _sessionRequest(url, {data, isBind}) {
        const qs = {
            RID: this._rid++,
            VER: 8,
            CVER: 1,
        };

        if (!isBind) {
            const reqId = this._next_request_id++;
            const reqPrefix = `req${reqId}`;

            data = Object.keys(data).reduce((m, k) => {
                if (k.startsWith('_')) {
                    m[reqPrefix + k] = data[k];
                } else {
                    m[k] = data[k];
                }
                return m;
            }, {});

            qs.SID = this._sid;
            qs.gsessionid = this._gsessionId;
        }

        try {
            return await request.post({
                url,
                qs,
                json: !isBind,
                form: data,
                headers: {
                    'X-YouTube-LoungeId-Token': this._loungeId,
                    origin: YOUTUBE_BASE_URL,
                },
            });
        } catch (e) {
            debug(e);

            // 404 resets the sid, session counters
            // 400 in session probably means bad sid
            // If user did a bad request (eg. remove an non-existing video from queue) bind restores the session.
            if (
                e.response.statusCode === 400
                || e.response.statusCode === 404
            ) {
                await this._bind();
            }

            if (e.response.statusCode === 410) {
                debug('input data', data);
                throw new Error('No such video');
            }

            throw e;
        }
    }
}

module.exports = YoutubeApp;
