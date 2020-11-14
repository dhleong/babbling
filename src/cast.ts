export interface IMediaStatus {
    currentItemId: number;

    /** floating point number in seconds */
    currentTime: number;

    mediaSessionId: number;
    playbackRate: number;
    playerState: "BUFFERING" | "IDLE" | "LOADING" | "PAUSED" | "PLAYING";
}

export interface IMediaStatusMessage {
    status: IMediaStatus[];
}

export interface IMedia {
    contentId: string;
    contentType: string;
    customData?: any;

    streamType: "BUFFERED";
}

export interface IQueueEntry {
    customData?: any;
    media: IMedia;
}

export interface ILoadRequest {
    autoplay?: boolean;
    currentTime?: number;
    customData?: any;
    media: IMedia;
    queueData?: {
        items: IQueueEntry[];
        startIndex: number;
    };
    sessionId: string;
    type: "LOAD";
}

