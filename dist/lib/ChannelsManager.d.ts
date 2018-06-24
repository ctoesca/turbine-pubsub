import * as turbine from "turbine";
import TeventDispatcher = turbine.events.TeventDispatcher;
import Promise = require("bluebird");
import { PubSubServer } from './PubSubServer';
export declare class ChannelsManager extends TeventDispatcher {
    pubSubServer: PubSubServer;
    _channels: any;
    logger: any;
    constructor(pubSubServer: PubSubServer);
    publish(messages: any): void;
    broadcast(messages: any): void;
    flatify(): Promise<{}>;
    start(): void;
    stop(): void;
    getChannelClients(channelName: string): Promise<{}>;
    getChannel(name: string, create?: boolean): any;
    createChannel(name: string): any;
    free(): void;
}
