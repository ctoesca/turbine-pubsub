import * as turbine from "turbine";
import TeventDispatcher = turbine.events.TeventDispatcher;
import Tevent = turbine.events.Tevent;
import Promise = require("bluebird");
import { Subscription } from './Subscription';
import { PubSubServer } from './PubSubServer';
import { Client } from './Client';
import Ttimer = turbine.tools.Ttimer;
export declare class Channel extends TeventDispatcher {
    pubSubServer: PubSubServer;
    maxStoredMessages: number;
    name: string;
    redisKey: string;
    subscriptions: Map<string, Subscription>;
    logger: any;
    purgeTimer: Ttimer;
    accessKey: string;
    constructor(name: string, pubSubServer: PubSubServer);
    static storeMessage(message: any): Promise<{}>;
    onPurgeTimer(e: any): void;
    addChannelInRedis(): void;
    stop(): void;
    start(): void;
    getClients(): Promise<{}>;
    flatify(): Promise<{}>;
    getMessages(): Promise<{}>;
    broadcast(message: any, filter: any): number;
    subscribeClient(client: Client, opt?: any): any;
    createSubscription(client: Client): Subscription;
    unsubscribeClient(client: Client): any;
    _removeSubscriptionById(id: string): any;
    sendChannelEvent(client: any, type: string): void;
    _onSubscriptionDestroy(e: Tevent): void;
    getSubscriptionById(id: any): any;
    getSubscriptions(): Map<string, Subscription>;
    getSubscription(client: Client): any;
    sendMessages(messages: any): void;
    free(): void;
}
