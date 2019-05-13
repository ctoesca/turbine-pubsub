import { PubSubServer } from './PubSubServer';
import Promise = require("bluebird");
import Logger = require("bunyan");
export declare class PurgeService {
    pubsubServer: PubSubServer;
    logger: Logger;
    config: any;
    constructor(pubsubServer: any, config?: any);
    getDefaultConfig(): {
        "redisConnexionsTimeout": number;
        "redisClientsTimeout": number;
        "destroyClientsTimeout": number;
    };
    raz(): void;
    purgeRedisConnections(): Promise<any[]>;
    purgeRedisClients(): any;
    purgeRedisSubscriptions(): any;
    destroyOldClients(): Promise<void>;
}
