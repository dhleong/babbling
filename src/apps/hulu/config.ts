
export interface IHuluOpts {
    /**
     * A string of cookies as might be retrieved from the "copy as
     * cURL" from any request on hulu.com in Chrome's network
     * inspector
     */
    cookies: string;

    /**
     * If provided, captions will be enabled if captions in the given
     * language areavailable. Example: `en` for english captions.
     */
    captionsLanguage?: string;
}
