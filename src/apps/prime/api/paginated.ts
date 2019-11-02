import _debug from "debug";
const debug = _debug("babbling:prime:api:paginated");

import { PrimeApi } from "../api";
import { IPrimeApiInternal } from "../model";

interface IPaginationLink {
    requestContext: {
        transform: string;
        requestParameters: {[key: string]: string},
    };
}

export interface IFirstPage<T> {
    items: T[];
    paginationLink?: IPaginationLink;
}

export class Paginated<T> implements AsyncIterable<T> {

    constructor(
        protected readonly api: PrimeApi,
        private readonly firstPage: IFirstPage<T>,
        private readonly transformItem: (raw: any) => T,
    ) {}

    public async *[Symbol.asyncIterator](): AsyncIterator<T, any, undefined> {
        const firstPage = this.firstPage;
        yield *firstPage.items;

        const api = this.api as unknown as IPrimeApiInternal;
        let pagination: IPaginationLink | undefined = firstPage.paginationLink;
        while (pagination) {
            if (pagination.requestContext.requestParameters.pageSize) {
                // reduce the number of round trips by upping the pageSize
                pagination.requestContext.requestParameters.pageSize = "50";
            }

            debug("fetch next page @", pagination);

            const { resource } = await api.swiftApiRequest(
                "/cdp/mobile/getDataByTransform/v1/" + pagination.requestContext.transform,
                pagination.requestContext.requestParameters,
            );
            pagination = resource.paginationLink;

            for (const item of resource.items) {
                yield this.transformItem(item);
            }
        }
    }
}
