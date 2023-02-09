import { AvailabilityType, type IAvailability } from "../model";
import { IWatchNextItem } from "./types";

export function cleanTitle(title: string) {
    // NOTE: These two hyphens look the same but... they're not!
    return title.replace(/( [-–])? Season \d+/, "").replace("(4K UHD)", "");
}

export function availabilityOf(item: any): IAvailability[] {
    const result: IAvailability[] = [];
    let isPrime = false;
    if (
        item.decoratedTitle.computed.simple.PRIME_BADGE &&
        item.analytics.local.isPrimeCustomer === "Y"
    ) {
        // included in active prime subscription
        result.push({ type: AvailabilityType.PRIME });
        isPrime = true;
    }

    if (!item.titleActions) {
        // quick shortcut
        return result;
    }

    if (
        item.titleActions.isPlayable &&
        item.titleActions.playbackSummary.includes("You purchased")
    ) {
        // explicitly purchased
        result.push({ type: AvailabilityType.OWNED });
    } else if (item.titleActions.isPlayable && !isPrime) {
        // if not purchased, it's probably included in prime, etc.
        result.push({ type: AvailabilityType.PRIME });
    } else if (!item.titleActions.isPlayable) {
        try {
            const summary: any = JSON.stringify(item.titleActions.titleSummary);
            if (summary.type === "purchase" && summary.price) {
                const type = item.titleActions.titleSummary.includes("Rent")
                    ? AvailabilityType.RENTABLE
                    : AvailabilityType.PURCHASABLE;
                result.push({
                    price: summary.price,
                    type,
                } as any);
            }
        } catch (e) {
            // ignore
        }
    }

    return result;
}

export function parseWatchNextItem(item: any): IWatchNextItem {
    return {
        title: item.title,
        titleId: item.titleId,

        completedAfter: item.playAndProgress.completedAfter,
        resumeTitleId: item.playAndProgress.titleId,
        runtimeSeconds: item.playAndProgress.runtimeSeconds,
        watchedSeconds: item.playAndProgress.watchedSeconds,
    };
}

export function parseWatchlistItem(item: any) {
    const availability = availabilityOf(item);
    const id = item.analytics.local.pageTypeId;
    return {
        availability,
        cover:
            item.decoratedTitle.images.imageUrls.detail_page_cover ??
            item.decoratedTitle.images.imageUrls.detail_page_hero,
        desc: item.decoratedTitle.catalog.synopsis,
        id,
        isInWatchlist: item.decoratedTitle.computed.simple.IS_IN_WATCHLIST,
        title: cleanTitle(item.decoratedTitle.catalog.title),
        titleId: item.titleId,
        type: item.decoratedTitle.catalog.type,
        watchUrl: `https://www.amazon.com/dp/${id}/?autoplay=1`,
    };
}

export function seasonNumberFromTitle(title: string) {
    const m = title.match(/Season (\d+)/);
    if (m) return parseInt(m[1], 10);
    return -1;
}
