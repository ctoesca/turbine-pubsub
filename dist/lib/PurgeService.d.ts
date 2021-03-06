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
        "notAuthenticatedClientsTimeout": number;
    };
    raz(): void;
    purgeRedisConnections(): Promise<void>;
    purgeRedisSubscriptions(): any;
    destroyOldClients(): Promise<void>;
}
