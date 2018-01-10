/// <reference types="bluebird" />
import * as turbine from "turbine";
import TeventDispatcher = turbine.events.TeventDispatcher;
import Tevent = turbine.events.Tevent;
import Promise = require("bluebird");
import { Subscription } from './Subscription';
import { PubSubServer } from './PubSubServer';
import { Client } from './Client';
export declare class Channel extends TeventDispatcher {
    pubSubServer: PubSubServer;
    maxStoredMessages: number;
    name: string;
    redisKey: string;
    subscriptions: any[];
    logger: any;
    constructor(name: string, pubSubServer: PubSubServer);
    stop(): void;
    start(): void;
    getClients(): Promise<{}>;
    flatify(): Promise<{}>;
    getMessages(): Promise<{}>;
    storeMessage(message: any): Promise<{}>;
    broadcast(message: any, filter: any): number;
    subscribeClient(client: Client, notifySubscribeEvents: any): any;
    createSubscription(client: Client): Subscription;
    unsubscribeClient(client: Client): any;
    _removeSubscriptionById(id: string): any;
    sendChannelEvent(client: Client, type: string): void;
    _onSubscriptionDestroy(e: Tevent): void;
    getSubscriptions(): any[];
    getSubscription(client: Client): any;
    sendMessages(messages: any): void;
    free(): void;
}
