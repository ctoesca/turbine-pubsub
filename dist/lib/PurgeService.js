"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
class PurgeService {
    constructor(pubsubServer, config = null) {
        this.pubsubServer = null;
        this.logger = null;
        this.config = null;
        this.pubsubServer = pubsubServer;
        if (config == null)
            this.config = this.getDefaultConfig();
        else
            this.config = config;
        this.logger = app.getLogger("PurgeService");
        this.logger.info("PurgeService created.");
    }
    getDefaultConfig() {
        return {
            "redisConnexionsTimeout": 600,
            "redisClientsTimeout": 600,
            "destroyClientsTimeout": 120
        };
    }
    raz() {
        app.ClusterManager.getClient().del("clientsConnexions");
        app.ClusterManager.getClient().del("clients");
        app.ClusterManager.getClient().del("subscriptions");
        app.ClusterManager.getClient().del("channels");
    }
    purgeRedisConnections() {
        var now = new Date().getTime() / 1000;
        return this.pubsubServer.getClusterConnexions()
            .then((result) => {
            var connToDelete = [];
            for (var connId in result) {
                var connexion = result[connId];
                var diffSec = null;
                if (typeof connexion.lastActivityDate == "number")
                    diffSec = now - (connexion.lastActivityDate / 1000);
                if ((diffSec === null) || (diffSec > this.config.redisConnexionsTimeout)) {
                    connToDelete.push(connId);
                }
            }
            if (connToDelete.length) {
                app.ClusterManager.getClient().hdel("clientsConnexions", connToDelete)
                    .then((result) => {
                    this.logger.info("Suppression " + connToDelete.length + " connexions dans REDIS");
                })
                    .catch((err) => {
                    this.logger.error("Suppression " + connToDelete.length + " connexions dans REDIS: " + err.toString());
                });
            }
            return connToDelete;
        });
    }
    purgeRedisClients() {
        this.logger.debug("purgeRedisClients");
        var now = new Date().getTime();
        var from = now - (this.config.redisClientsTimeout * 1000);
        return app.ClusterManager.getClient().hgetall("clients")
            .then(result => {
            let clientsId = [];
            for (var clientId in result) {
                var client = JSON.parse(result[clientId]);
                var toDelete = (typeof client.closeDate === "undefined") || (typeof client.connected === "undefined");
                if (client.closeDate !== null) {
                    toDelete = toDelete || (client.closeDate < from);
                }
                if (toDelete) {
                    this.logger.error(client);
                    clientsId.push(client.id);
                }
            }
            if (clientsId.length > 0) {
                this.logger.info("Supression de " + clientsId.length + " clients dans REDIS");
                return app.ClusterManager.getClient().hdel("clients", clientsId);
            }
            else {
                return Promise.resolve();
            }
        })
            .catch(err => {
            this.logger.error("purgeRedisClients", err);
        });
    }
    purgeRedisSubscriptions() {
        var clients;
        return app.ClusterManager.getClient().hgetall("clients")
            .then((result) => {
            clients = result;
            return app.ClusterManager.getClient().hgetall("subscriptions");
        })
            .then((subscriptions) => {
            var r = {};
            var subscriptionsToDelete = [];
            var messagesQueuesToDelete = [];
            for (var key in subscriptions) {
                var sub = JSON.parse(subscriptions[key]);
                if (!sub.cid) {
                    this.logger.warn("sub.cid non défini: key=" + key);
                }
                else {
                    var channelName = sub.channelName;
                    var messagesQueuesId = channelName + "_" + sub.cid + "_messages_queue";
                    var clientExists = (typeof clients[sub.cid] !== "undefined");
                    if (!clientExists) {
                        subscriptionsToDelete.push(key);
                        messagesQueuesToDelete.push(messagesQueuesId);
                    }
                }
            }
            var promises = [];
            if (subscriptionsToDelete.length > 0) {
                this.logger.info("Suppression de " + subscriptionsToDelete.length + " subscription(s) dans REDIS");
                promises.push(app.ClusterManager.getClient().hdel("subscriptions", subscriptionsToDelete));
                promises.push(app.ClusterManager.getClient().del(messagesQueuesToDelete));
            }
            return Promise.all(promises);
        })
            .then((deleteResult) => {
            return app.ClusterManager.getClient().keys(app.ClusterManager.keyPrefix + "*_messages_queue");
        })
            .then((results) => {
        });
    }
    destroyOldClients() {
        var now = new Date().getTime() / 1000;
        var connectedClients = 0;
        var toDelete = [];
        for (var i in this.pubsubServer.clients) {
            var c = this.pubsubServer.clients[i];
            if (c == null) {
                this.logger.warn(i + " => NULL client");
                toDelete.push(i);
            }
            else {
                if ((c.conn == null) && c.closeDate) {
                    this.logger.debug(i + " => client.conn = NULL, clientId=" + c.getShortId());
                    var diffSec = now - (c.closeDate / 1000);
                    if (diffSec > this.config.destroyClientsTimeout) {
                        c.free();
                        toDelete.push(i);
                    }
                }
                else {
                    c.touchClusterClient();
                    if (c.id) {
                        this.logger.debug(i + " => client authenticated, clientId=" + c.getShortId());
                        connectedClients++;
                    }
                    else {
                        this.logger.debug(i + " => client not authenticated");
                    }
                }
            }
        }
        for (var j = 0; j < toDelete.length; j++) {
            delete this.pubsubServer.clients[toDelete[j]];
        }
        this.logger.info("Worker " + process.pid + ": Clients connected:" + connectedClients + ", supprimés:" + toDelete.length);
        return Promise.resolve();
    }
}
exports.PurgeService = PurgeService;
//# sourceMappingURL=PurgeService.js.map