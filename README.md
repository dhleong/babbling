Babbling [![npm](https://img.shields.io/npm/v/babbling.svg)](https://www.npmjs.com/package/babbling)
========

*Cast Streaming service videos to Chromecast*

## What?

*Babbling*, as in *babbling brook*, refers to the streaming services it
helps bridge to your Chromecast. It's also a bit of a play on the Tower
of Babel, because it "speaks" to many *different* services.

## No, but seriously, what?

Babbling aims to provide a simple, promise-based API (and also a CLI
app!) for programmatically casting media from various streaming
services to a Chromecast device.

Currently, Babbling supports casting videos from:

- [Youtube][1]
- [HBO Max][2]
- [Hulu][3]
- [Amazon Video][5]
- [Disney+][6]

### Typescript/Javascript

Each app works a bit differently and has different capabilities,
so you interact with them slightly differently—though we do strive
for some consistency. For example, Youtube supports specifying the
name of the device you're connecting with, so we support that option:

```typescript
const device = new ChromecastDevice("Living Room TV");
const yt = await device.openApp(YoutubeApp, {
    deviceName: "Home",
});
await yt.play("video-id");
```

Please see the specific app implementations for details about each's
specific API.

### An easier option

Most people won't be interested in the specific app implementations.
If you're such a person, Babbling offers a simpler interface:

```typescript
const player = (await PlayerBuilder.autoInflate())
    .addDevice(new ChromecastDevice("Living Room TV"))
    .build();
await player.playUrl("https://www.youtube.com/watch?v=byva0hOj8CU&list=PL1tiwbzkOjQxD0jjAE7PsWoaCrs0EkBH2");
```

As of writing, all the apps currently supported also support the [Player][4]
interface, allowing you to just copy the URL of the thing you want to watch
and paste it in, whether it's for a Series, a Playlist, or a specific Episode.
In addition to URL-based playback, most apps allow you to search for what you
want—see the full [Player API](#player-api) section below.

This does gloss over something slightly, which is authenticating each
app. While Youtube can work fine without auth, if you have Youtube RED
and don't want to see ads—or if you want to watch personal playlists,
or keep track of watch progress in videos—you'll want to be authenticated.

### Authentication

You're welcome to do this by hand—just see each specific app for their
options—but Babbling comes with batteries included to make this simpler
for you. If you install Babbling globally (`npm i -g babbling`) you'll
get a command-line tool that can automatically pull all the cookies and
other auth info needed for each app from the Chrome browser. Just close
Chrome (the database in which HBO Max stores its data is very insistent
on only one app accessing it at a time) and run `babbling auto-auth`.
That will enable the `autoInflate()` function mentioned above, and
also allow you to use `babbling cast <url>`!

#### Amazon Video

Authentication for Amazon Video is a bit of a special case, requiring
you to login with your email and password. We do not store your password,
but we need to login in a specific way to be able to communicate with the
Amazon Video Chromecast app.

This can be performed easily with the Babbling command-line tool:

```
babbling auth:prime <your@amazon-login>
```

You will be prompted for your password, and, if everything goes well, you
well then be able to use `babbling cast <url>`, etc., for Amazon videos!

#### Youtube

The auto-auth tool will work for a time with Youtube, but Google's cookies
have a fairly short shelf-life. If you want to authenticate Babbling to be
able to cast Youtube videos for a longer period of time without having to
constantly re-run `auto-auth`, we've got a tool for that, too:

```
babbling auth:youtube
```

This will open a Chrome browser for authenticating. The mechanism here is
based on that used for [YakYak][7], and has the same caveats:

> babbling may show up as iOS Device and Google may alert you that "some iOS
> Device is trying to use your account". This is normal as babbling is an
> unofficial client and it mimics the behaviour of an iOS device in order to
> establish a communication with Youtube APIs.

⚠️ Note: in addition to the above caveat, you may run into an issue where the
authentication browser opened crashes when arriving at the two-factor auth step,
if you have a Security Key attached as a second factor option. It's not clear
what causes this, but you can temporarily remove the Security Key and fallback
to another second factor (ex: sign-in prompt, authenticator app, etc) and then
login should proceed as expected. You may re-add the Security Key after completing
login without affecting the continued operation of Babbling's Youtube integration.

## Player API

You've seen the `playUrl` tool above, but here's everything the `Player`
lets you do:

### `playUrl(url: string, opts: IPlayableOptions = {}): Promise`

- `url`: The URL of the video or series you want to play
- `opts`: An optional options map:
    - `resume: boolean`: if `false`, will *not* attempt to resume plaback

Play a video or series by its URL, as found in a browser. Returns a `Promise`
that resolves when the video has been started.

### `play(result: IQueryResult, opts: IPlayableOptions = {}): Promise`

- `result`: A Result object
- `opts`: As above

Play a search result from one of the other query methods. Returns a `Promise`
that resolves when the video has been started.

### `findEpisodeFor(item: IQueryResult, query: IEpisodeQuery): Promise<IEpisodeQueryResult | undefined>`

- `item`: A Result object
- `query`: An Episode Query object:
    - `episodeIndex`: 0-based index within a season
    - `seasonIndex`: 0-based season index

Try to find an episode for the given Result matching the given query. The
result, if not-`undefined`, can be used with `play()`. The Promise will
resolve to `undefined` if the `item` is not a series, or there is no such
season/episode combination.

### `queryByTitle(title: string, onError?: AppSpecificErrorHandler): AsyncIterable<IQueryResult>`

- `title`: The media item title you want to play
- `onError`: A handler when one app encounters an error:
    - `fn(app: string, e: Error)`
    - If omitted, every error will be thrown; you may instead want to simply
      log the error so errors in one app don't crash the whole query

Look for media items (eg series or movies) by their title. Returns an
AsyncIterable of Query Results, to be consumed as eg:

```js
for await (const result of p.queryByTitle("firefly")) {
    // do something with `result`
}
```

### `queryEpisodeForTitle(title: string, query: IEpisodeQuery, onError: AppSpecificErrorHandler): AsyncIterable<IEpisodeQueryResult>`

This method is sort of a combination of `queryByTitle` and `findEpisodeFor`
(see above), and the arguments are the same as for those methods. Some apps
can perform this query efficiently, and it is the most common use-case, but
others will be implemented naively as a composition of `queryByTitle` and
`findEpisodeFor`.

### `getRecommendationsMap(): Promise<Map<string, AsyncIterable<IQueryResult>>>`

Returns a map whose keys are app names (eg: `"HuluApp"`) and the values are
`AsyncIterable` objects in the same format as for `queryByTitle`. The query
results returned by this method represent app-provided media recommendations.

### `queryRecommended(onError?: AppSpecificErrorHandler): AsyncIterable<IQueryResult>`

Returns an `AsyncIterable` of recommendations as returned from
`getRecommendationsMap` that has results from all the different apps
interleaved together.

[1]: src/apps/youtube/index.ts
[2]: src/apps/hbo/index.ts
[3]: src/apps/hulu/index.ts
[4]: src/player.ts
[5]: src/apps/prime/index.ts
[6]: src/apps/disney/index.ts
[7]: https://github.com/yakyak/yakyak
