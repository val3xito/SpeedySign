export class AsyncQueue {
    private concurrency: number;
    private running: number = 0;
    private queue: (() => void)[] = [];

    constructor(concurrency: number) {
        this.concurrency = concurrency;
    }

    async enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) {
            throw new Error("Cancelled");
        }

        if (this.running >= this.concurrency) {
            await new Promise<void>((resolve, reject) => {
                let wrapper: () => void;
                const onAbort = () => {
                    const idx = this.queue.indexOf(wrapper);
                    if (idx !== -1) {
                        this.queue.splice(idx, 1);
                    }
                    reject(new Error("Cancelled"));
                };

                wrapper = () => {
                    if (signal) {
                        signal.removeEventListener("abort", onAbort);
                    }
                    resolve();
                };

                this.queue.push(wrapper);

                if (signal) {
                    signal.addEventListener("abort", onAbort, { once: true });
                }
            });
        }

        this.running++;
        try {
            if (signal?.aborted) {
                throw new Error("Cancelled");
            }
            return await task();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                if (next) next();
            }
        }
    }

    getWaitingCount(): number {
        return this.queue.length;
    }
}

// Global queue for signing jobs. Adjust concurrency based on server capacity.
// A concurrency of 1 or 2 is safe for free/small tiers to avoid CPU/RAM exhaustion.
// Increased default concurrency to 8 (highly optimized for 4 OCPU / 24 GB Oracle servers).
const CONCURRENCY = parseInt(process.env.SIGNING_CONCURRENCY || "8", 10);
export const signQueue = new AsyncQueue(CONCURRENCY);
