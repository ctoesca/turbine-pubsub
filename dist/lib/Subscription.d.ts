import * as turbine from "turbine";
import TeventDispatcher = turbine.events.TeventDispatcher;
import Tevent = turbine.events.Tevent;
import { Channel } from './Channel';
import { Client } from './Client';
import { Queue } from './Queue.js';
import Promise = require("bluebird");
export declare class Subscription extends TeventDispatcher {
    id: string;
    _queue: Queue;
    logger: any;
    notifySubscribeEvents: boolean;
    channelName: string;
    noClientTimeout: number;
    clientDestroyTimestamp: number;
    client: Client;
    channel: Channel;
    constructor(channel: Channel, client: Client);
    toJson(): string;
    fromJson(json: string): any;
    flatify(): Promise<{}>;
    broadcast(message: any): number;
    getQueue(): Queue;
    getClient(): Client;
    _onClientClose(e: any): void;
    _onClientDestroy(e: Tevent): void;
    free(): void;
}
