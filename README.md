Babbling [![npm](https://img.shields.io/npm/v/babbling.svg)](https://www.npmjs.com/package/babbling)
========

*Cast Streaming service videos to Chromecast*

## What?

*Babbling*, as in *babbling brook*, refers to the streaming services it
helps bridge to your Chromecast. It's also a bit of a play on the Tower
of Babel, because that it "speaks" to many *different* services.

## No, but seriously, what?

Babbling aims to provide a simple, promise-based API (and also a CLI
app!) for programmatically casting media from various streaming
services to a Chromecast device.

Currently, Babbling supports casting videos from:

- [Youtube][1]
- [HBO Go][2]
- [Hulu][3]

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

As of writing, all the apps currently supported also support the
[Player][4] interface, allowing you to just copy the URL of the thing
you want to watch and paste it in, whether it's for a Series, a
Playlist, or a specific Episode.

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
Chrome (the database in which HBO Go stores its data is very insistent
on only one app accessing it at a time) and run `babbling auto-auth`.
That will enable the `autoInflate()` function mentioned above, and
also allow you to use `babbling cast <url>`!

[1]: src/apps/youtube/index.ts
[2]: src/apps/hbogo/index.ts
[3]: src/apps/hulu.ts
[4]: src/player.ts
