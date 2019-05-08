import { PubSubServer } from './PubSubServer';
import Promise = require("bluebird");
import Logger = require("bunyan");
export declare class PurgeService {
    pubsubServer: PubSubServer;
    logger: Logger;
    config: any;
    constructor(pubsubServer: any, config: any);
    getDefaultConfig(): {
        "clientCleanInterval": number;
        "clientCleanTimeout": number;
    };
    purgeRedisConnections(): Promise<void>;
    purgeRedisSubscriptions(): Promise<any[]>;
    purgeRedisClients(): any;
    destroyOldClients(): Promise<void>;
}
