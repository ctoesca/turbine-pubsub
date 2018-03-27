/// <reference types="bluebird" />
import * as turbine from "turbine";
import TeventDispatcher = turbine.events.TeventDispatcher;
import { Subscription } from './Subscription';
import Promise = require("bluebird");
export declare class Queue extends TeventDispatcher {
    subscription: Subscription;
    messages: any[];
    logger: any;
    maxLength: number;
    constructor(subscription: any);
    getKey(): string;
    addMessage(message: any): void;
    _addMessage(message: any): void;
    consume(): any[];
    getMessages(): Promise<{}>;
    getSize(): Promise<{}>;
    free(): void;
    clear(): any;
}
