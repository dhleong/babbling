import _debug from "debug";

import { PrimeApi } from "../api";
import { IPrimeApiInternal } from "../model";

const debug = _debug("babbling:prime:api:paginated");

interface IPaginationLink {
    requestContext: {
        transform: string;
        requestParameters: { [key: string]: string },
    };
}

export interface IFirstPage {
    paginationLink?: IPaginationLink;
}

function getItemsDefault(page: any) {
    return page.items;
}

export class Paginated<T> implements AsyncIterable<T> {
    constructor(
        protected readonly api: PrimeApi,
        private readonly firstPage: IFirstPage,
        private readonly transformItem: (raw: any) => T,
        private readonly getItems: (page: any) => any[] = getItemsDefault,
    ) {}

    public async* [Symbol.asyncIterator](): AsyncIterator<T> {
        const { firstPage } = this;
        yield* this.getItems(firstPage).map(this.transformItem);

        const api = this.api as unknown as IPrimeApiInternal;
        let pagination: IPaginationLink | undefined = firstPage.paginationLink;
        while (pagination) {
            if (pagination.requestContext.requestParameters.pageSize) {
                // reduce the number of round trips by upping the pageSize
                pagination.requestContext.requestParameters.pageSize = "50";
            }

            debug("fetch next page @", pagination);

            const { resource } = await api.swiftApiRequest(
                `/cdp/mobile/getDataByTransform/v1/${pagination.requestContext.transform}`,
                pagination.requestContext.requestParameters,
            );
            pagination = resource.paginationLink;

            const items = this.getItems(resource);
            if (!items) {
                debug("no more items");
                break;
            }

            for (const item of items) {
                yield this.transformItem(item);
            }
        }
    }
}
