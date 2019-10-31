import { ChannelsManager } from './ChannelsManager';
import { Client } from './Client';
import Promise = require("bluebird");
export interface IPubSubServer {
    canSubscribe(client: any, channelName: any): any;
    start(): any;
    stop(): any;
    flatify(): Promise<{}>;
    getClusterConnexions(): Promise<{}>;
    getClusterClients(): Promise<{}>;
    getClusterClient(id: string): Promise<{}>;
    getChannelsManager(): ChannelsManager;
    sendChannelEvent(type: string, channelName: string, DBClient: any): any;
    eachConnection(callback: any): any;
    eachClient(callback: any): any;
    removeClient(client: Client): any;
    getClientById(id: string): any;
    getClientsByUsername(username: string): any;
    publish(messages: any, exclude?: any): any;
    sendToUsers(userNames: string[], messages: any): any;
    sendToClients(clientsId: string[], messages: any): any;
    disconnectClusterClient(id: string): any;
}
