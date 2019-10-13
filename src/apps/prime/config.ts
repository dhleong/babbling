export interface IPrimeApiOpts {
    deviceId?: string;
    apiDomain?: string;
}

export interface IPrimeOpts extends IPrimeApiOpts {
    // TODO
    cookies: string;
    refreshToken: string;

    marketplaceId?: string;
    apiDomain?: string;
}
