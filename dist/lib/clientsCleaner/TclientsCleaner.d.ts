import Promise = require("bluebird");
import { TbaseService } from '../TbaseService';
import { Ttimer } from '../../tools/Ttimer';
export declare class TclientsCleaner extends TbaseService {
    timer: Ttimer;
    constructor(name: any, config: any);
    getDefaultConfig(): {
        "active": boolean;
        "executionPolicy": string;
        "cleanInterval": number;
        "clientsTimeout": number;
    };
    flatify(): Promise<{}>;
    start(): void;
    stop(): void;
    onTimer(): void;
}
