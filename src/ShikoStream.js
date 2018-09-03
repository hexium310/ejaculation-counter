const PQueue = require("p-queue");
const WebSocket = require("ws");
const xpath = require("xpath");
const { DOMParser } = require("xmldom");
const { fromEvent, from } = require("rxjs");
const { filter, map, mergeMap, toArray } = require("rxjs/operators");

exports.ShikoStream = class ShikoStream {
    constructor(service, actions) {
        this.service = service;
        this.actions = actions;
        this.queue = new PQueue({
            concurrency: 1,
        });
    }

    create() {
        this.stream = new WebSocket(
            `${process.env.MASTODON_WSS_URL}streaming?access_token=${process.env.MASTODON_ACCESS_TOKEN}&stream=user`,
        );

        fromEvent(this.stream, "message").pipe(
            map(x => JSON.parse(x.data)),
            filter(x => x.event === "update"),
            map(x => JSON.parse(x.payload)),
            map(x => this.service.decodeToot(x)),
            mergeMap(toot => from(this.actions).pipe(
                map(action => ({ match: action.regex.exec(toot.content), action, toot })),
                filter(({ match }) => match),
                toArray(),
                map(x => x.sort((a, b) => a.match.index - b.match.index)),
            )),
            mergeMap(x => x, (outer, inner) => inner),
        ).subscribe(
            (...args) => this.onMessage(...args),
        );

        fromEvent(this.stream, "error").subscribe(
            (...args) => this.onError(...args),
        );

        fromEvent(this.stream, "close").subscribe(
            (...args) => this.onClose(...args),
        );
    }

    onMessage({ action, toot }) {
        this.queue.add(() => action.invoke(toot));
    }

    onError(error) {
        console.error(error);
    }

    onClose() {
        console.warn("Connection was closed. Reconnecting...");
        this.create();
    }
}